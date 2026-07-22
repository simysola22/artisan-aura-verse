-- PMP Stage 10 — Job Marketplace
--
-- Adds:
--   • job_status enum           — draft / published / closed
--   • work_type enum            — remote / onsite / hybrid
--   • application_status enum   — pending / reviewed / shortlisted / rejected / accepted
--   • jobs                      — job postings by employers
--   • job_applications          — provider applications with duplicate-prevention
--
-- Security notes:
--   • jobs.employer_profile_id is a FK to employer_profiles — employers own their jobs.
--   • job_applications has a UNIQUE constraint on (job_id, provider_profile_id).
--   • Authorization (employer-only create, provider-only apply) is enforced in the
--     service layer, not in the DB schema, for auditability.
--
-- This migration is additive — no existing tables are altered.
-- Safe to run on a Stage 9 (operations) database.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "job_status" AS ENUM ('draft', 'published', 'closed');
CREATE TYPE "work_type" AS ENUM ('remote', 'onsite', 'hybrid');
CREATE TYPE "application_status" AS ENUM (
  'pending',
  'reviewed',
  'shortlisted',
  'rejected',
  'accepted'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Jobs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "jobs" (
  "id"                  text        PRIMARY KEY NOT NULL,
  "employer_profile_id" text        NOT NULL
      REFERENCES "employer_profiles"("id") ON DELETE CASCADE,
  "title"               text        NOT NULL,
  "description"         text        NOT NULL,
  "category"            text,
  "skills"              text[]      NOT NULL DEFAULT '{}',
  "location"            text,
  "work_type"           "work_type" NOT NULL DEFAULT 'onsite',
  "budget_min"          integer,
  "budget_max"          integer,
  "currency"            text        NOT NULL DEFAULT 'NGN',
  "status"              "job_status" NOT NULL DEFAULT 'draft',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "published_at"        timestamptz,
  "deadline"            timestamptz
);

CREATE INDEX "jobs_employer_profile_idx" ON "jobs" ("employer_profile_id");
CREATE INDEX "jobs_status_idx"           ON "jobs" ("status");
CREATE INDEX "jobs_created_at_idx"       ON "jobs" ("created_at" DESC);
CREATE INDEX "jobs_category_idx"         ON "jobs" ("category");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Job Applications
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "job_applications" (
  "id"                  text               PRIMARY KEY NOT NULL,
  "job_id"              text               NOT NULL
      REFERENCES "jobs"("id") ON DELETE CASCADE,
  "provider_profile_id" text               NOT NULL
      REFERENCES "provider_profiles"("id") ON DELETE CASCADE,
  "cover_message"       text               NOT NULL,
  "proposed_rate"       integer,
  "currency"            text               NOT NULL DEFAULT 'NGN',
  "status"              "application_status" NOT NULL DEFAULT 'pending',
  "created_at"          timestamptz        NOT NULL DEFAULT now(),
  "updated_at"          timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX "job_applications_job_idx"      ON "job_applications" ("job_id");
CREATE INDEX "job_applications_provider_idx" ON "job_applications" ("provider_profile_id");
CREATE INDEX "job_applications_status_idx"   ON "job_applications" ("status");

-- One application per provider per job (prevents duplicates).
CREATE UNIQUE INDEX "job_applications_unique_idx"
  ON "job_applications" ("job_id", "provider_profile_id");
