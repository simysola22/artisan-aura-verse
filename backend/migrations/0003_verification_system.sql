-- PMP Stage 4 — Verification System
--
-- Adds:
--   • verification_case_status enum
--   • evidence_type enum
--   • verification_audit_action enum
--   • verification_cases
--   • verification_evidence
--   • verification_notes
--   • verification_audit_log
--
-- This migration is additive — no existing tables are altered.
-- Safe to run on a Stage 3 database.
--
-- Production (Railway PostgreSQL): run `bun run db:migrate` from backend/.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "verification_case_status" AS ENUM (
  'draft',
  'submitted',
  'under_review',
  'info_requested',
  'resubmitted',
  'approved',
  'rejected',
  'escalated'
);

CREATE TYPE "evidence_type" AS ENUM (
  'cv_resume',
  'certificate',
  'work_sample',
  'portfolio_evidence',
  'employment_evidence',
  'reference',
  'identity_document',
  'other'
);

CREATE TYPE "verification_audit_action" AS ENUM (
  'case_created',
  'case_submitted',
  'case_claimed',
  'info_requested',
  'case_resubmitted',
  'case_approved',
  'case_rejected',
  'case_escalated',
  'note_added',
  'evidence_added',
  'evidence_removed'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. verification_cases
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "verification_cases" (
  "id"                    TEXT PRIMARY KEY,
  "provider_profile_id"   TEXT NOT NULL REFERENCES "provider_profiles"("id") ON DELETE CASCADE,
  "user_id"               TEXT NOT NULL REFERENCES "users"("id")             ON DELETE CASCADE,
  "status"                "verification_case_status" NOT NULL DEFAULT 'draft',
  "verification_type"     TEXT NOT NULL CHECK ("verification_type" IN ('artisan', 'professional')),
  "claimed_by"            TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "info_request_message"  TEXT,
  "provider_response"     TEXT,
  "decision_reason"       TEXT,
  "submitted_at"          TIMESTAMPTZ,
  "claimed_at"            TIMESTAMPTZ,
  "decided_at"            TIMESTAMPTZ,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "verification_cases_provider_profile_idx" ON "verification_cases"("provider_profile_id");
CREATE INDEX "verification_cases_user_id_idx"          ON "verification_cases"("user_id");
CREATE INDEX "verification_cases_status_idx"           ON "verification_cases"("status");
CREATE INDEX "verification_cases_claimed_by_idx"       ON "verification_cases"("claimed_by");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. verification_evidence
--
-- Stores metadata and URL references only. Binary files live in object storage.
-- storage_key allows the URL to be re-signed or migrated between storage
-- providers (S3, R2, Supabase Storage, etc.) without touching this table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "verification_evidence" (
  "id"            TEXT PRIMARY KEY,
  "case_id"       TEXT NOT NULL REFERENCES "verification_cases"("id") ON DELETE CASCADE,
  "evidence_type" "evidence_type" NOT NULL,
  "label"         TEXT NOT NULL,
  "file_url"      TEXT NOT NULL,
  "storage_key"   TEXT,
  "mime_type"     TEXT,
  -- Soft delete: set true when provider removes evidence before submission.
  -- Never physically deleted so the audit trail remains intact.
  "is_removed"    BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "verification_evidence_case_idx"    ON "verification_evidence"("case_id");
CREATE INDEX "verification_evidence_type_idx"    ON "verification_evidence"("evidence_type");
CREATE INDEX "verification_evidence_removed_idx" ON "verification_evidence"("is_removed");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. verification_notes
--
-- Internal reviewer notes. NEVER exposed to providers.
-- Stored in a separate table so provider-facing queries cannot accidentally
-- include notes (no JOIN required, no column to accidentally SELECT).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "verification_notes" (
  "id"          TEXT PRIMARY KEY,
  "case_id"     TEXT NOT NULL REFERENCES "verification_cases"("id") ON DELETE CASCADE,
  "reviewer_id" TEXT NOT NULL REFERENCES "users"("id")              ON DELETE SET NULL,
  "content"     TEXT NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "verification_notes_case_idx" ON "verification_notes"("case_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. verification_audit_log
--
-- Append-only. The application NEVER issues UPDATE or DELETE on this table.
-- metadata stores a JSON string with action-specific context.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "verification_audit_log" (
  "id"          TEXT PRIMARY KEY,
  "case_id"     TEXT NOT NULL REFERENCES "verification_cases"("id") ON DELETE CASCADE,
  "actor_id"    TEXT NOT NULL REFERENCES "users"("id")              ON DELETE SET NULL,
  "action"      "verification_audit_action" NOT NULL,
  "from_status" "verification_case_status",
  "to_status"   "verification_case_status",
  "metadata"    TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "verification_audit_case_idx"   ON "verification_audit_log"("case_id");
CREATE INDEX "verification_audit_actor_idx"  ON "verification_audit_log"("actor_id");
CREATE INDEX "verification_audit_action_idx" ON "verification_audit_log"("action");
