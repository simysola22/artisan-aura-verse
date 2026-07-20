-- PMP initial schema — Stage 1 foundation
-- Drizzle-kit generated migrations live here and are applied in order.

CREATE TYPE "user_role" AS ENUM ('employer', 'provider');

CREATE TABLE "users" (
  "id"            TEXT PRIMARY KEY,
  "email"         TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role"          "user_role" NOT NULL,
  "display_name"  TEXT NOT NULL,
  "avatar_url"    TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at"    TIMESTAMPTZ
);

CREATE TABLE "sessions" (
  "id"            TEXT PRIMARY KEY,
  "user_id"       TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token"         TEXT NOT NULL UNIQUE,
  "refresh_token" TEXT UNIQUE,
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "revoked"       BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_used_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "user_agent"    TEXT,
  "ip_address"    TEXT
);

CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "users_email_idx"      ON "users"("email");
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at") WHERE "deleted_at" IS NULL;
