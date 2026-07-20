-- PMP Stage 2 — Clerk identity + RBAC
--
-- Changes from Stage 1:
--   • Drop custom sessions table (Clerk now owns session lifecycle)
--   • Replace the custom users schema with a Clerk-centric identity model
--   • Introduce fine-grained RBAC: roles, permissions, role_permissions, user_roles
--   • Seed all initial roles and permissions
--
-- This migration is idempotent-safe to run on a fresh Stage-1 database.
-- Production (Railway PostgreSQL) usage: run `bun run db:migrate` from backend/.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the custom sessions table (Clerk handles sessions now)
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS "sessions";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Reshape the users table for Clerk identity
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove credentials / old role column that are now owned by Clerk
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";

-- Make cached-from-Clerk fields nullable (Clerk is the source of truth)
ALTER TABLE "users" ALTER COLUMN "email"        DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "display_name" DROP NOT NULL;

-- New enums
CREATE TYPE "account_type" AS ENUM (
  'employer', 'provider',
  'owner', 'system_admin', 'verification_team', 'support_team', 'moderation_team'
);

CREATE TYPE "provider_kind" AS ENUM ('artisan', 'professional');

CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'deleted');

-- New columns
ALTER TABLE "users"
  ADD COLUMN "clerk_user_id" TEXT,
  ADD COLUMN "account_type"  "account_type",
  ADD COLUMN "provider_kind" "provider_kind",
  ADD COLUMN "status"        "user_status" NOT NULL DEFAULT 'active';

-- If any existing rows exist (should be none in Stage 1), give them placeholder
-- clerk_user_id values so the NOT NULL + UNIQUE constraints can be applied.
-- (Safe to skip on an empty table.)
-- UPDATE "users" SET "clerk_user_id" = 'migrate_' || id WHERE "clerk_user_id" IS NULL;
-- UPDATE "users" SET "account_type"  = 'employer'          WHERE "account_type" IS NULL;

ALTER TABLE "users" ALTER COLUMN "clerk_user_id" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "account_type"  SET NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_clerk_user_id_unique" UNIQUE ("clerk_user_id");
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");

-- Drop the old user_role enum (was used by the dropped column)
DROP TYPE IF EXISTS "user_role";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RBAC tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "roles" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "permissions" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "role_permissions" (
  "role_id"       TEXT NOT NULL REFERENCES "roles"("id")       ON DELETE CASCADE,
  "permission_id" TEXT NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_roles" (
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  PRIMARY KEY ("user_id", "role_id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed roles
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "roles" ("id", "name", "description") VALUES
  ('role_employer',          'employer',          'Employer — posts jobs and finds providers'),
  ('role_provider',          'provider',          'Provider — artisans and professionals'),
  ('role_owner',             'owner',             'Platform owner — full system access'),
  ('role_system_admin',      'system_admin',      'System administrator'),
  ('role_verification_team', 'verification_team', 'Verification team member'),
  ('role_support_team',      'support_team',      'Customer support team member'),
  ('role_moderation_team',   'moderation_team',   'Content moderation team member');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed permissions
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permissions" ("id", "name", "description") VALUES
  -- Profile
  ('perm_profile_read',               'profile.read',               'Read own profile'),
  ('perm_profile_update',             'profile.update',             'Update own profile'),
  -- Providers
  ('perm_providers_search',           'providers.search',           'Search provider listings'),
  ('perm_providers_view',             'providers.view',             'View provider profiles'),
  -- Messaging
  ('perm_messaging_use',              'messaging.use',              'Send and receive messages'),
  -- Verification
  ('perm_verification_submit',        'verification.submit',        'Submit own verification application'),
  ('perm_verification_read',          'verification.read',          'Read verification applications'),
  ('perm_verification_review',        'verification.review',        'Review verification applications'),
  ('perm_verification_request_info',  'verification.request_info',  'Request additional info from applicant'),
  ('perm_verification_approve',       'verification.approve',       'Approve a verification application'),
  ('perm_verification_reject',        'verification.reject',        'Reject a verification application'),
  ('perm_verification_manage',        'verification.manage',        'Manage verification system configuration'),
  -- Support
  ('perm_support_read',               'support.read',               'Read support tickets'),
  ('perm_support_respond',            'support.respond',            'Respond to support tickets'),
  ('perm_support_manage',             'support.manage',             'Manage support system'),
  -- Moderation
  ('perm_moderation_read',            'moderation.read',            'Read moderation queue'),
  ('perm_moderation_review',          'moderation.review',          'Review moderation items'),
  ('perm_moderation_action',          'moderation.action',          'Take moderation actions'),
  ('perm_moderation_manage',          'moderation.manage',          'Manage moderation system'),
  -- Users
  ('perm_users_read',                 'users.read',                 'Read user accounts'),
  ('perm_users_manage',               'users.manage',               'Manage user accounts'),
  -- System
  ('perm_system_manage',              'system.manage',              'Manage system configuration');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Seed role → permission mappings
-- ─────────────────────────────────────────────────────────────────────────────

-- employer
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('role_employer', 'perm_profile_read'),
  ('role_employer', 'perm_profile_update'),
  ('role_employer', 'perm_providers_search'),
  ('role_employer', 'perm_providers_view'),
  ('role_employer', 'perm_messaging_use');

-- provider
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('role_provider', 'perm_profile_read'),
  ('role_provider', 'perm_profile_update'),
  ('role_provider', 'perm_verification_submit'),
  ('role_provider', 'perm_messaging_use');

-- verification_team
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('role_verification_team', 'perm_verification_read'),
  ('role_verification_team', 'perm_verification_review'),
  ('role_verification_team', 'perm_verification_request_info'),
  ('role_verification_team', 'perm_verification_approve'),
  ('role_verification_team', 'perm_verification_reject');

-- support_team
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('role_support_team', 'perm_support_read'),
  ('role_support_team', 'perm_support_respond'),
  ('role_support_team', 'perm_support_manage');

-- moderation_team
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('role_moderation_team', 'perm_moderation_read'),
  ('role_moderation_team', 'perm_moderation_review'),
  ('role_moderation_team', 'perm_moderation_action');

-- system_admin
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('role_system_admin', 'perm_users_read'),
  ('role_system_admin', 'perm_users_manage'),
  ('role_system_admin', 'perm_verification_manage'),
  ('role_system_admin', 'perm_support_manage'),
  ('role_system_admin', 'perm_moderation_manage'),
  ('role_system_admin', 'perm_system_manage');

-- owner — all permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
  SELECT 'role_owner', "id" FROM "permissions";
