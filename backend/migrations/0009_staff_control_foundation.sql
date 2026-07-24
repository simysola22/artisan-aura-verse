-- PMP Phase 1 — Staff-control security foundation
--
-- This migration is additive:
--   • preserves the existing owner/system_admin/team role names
--   • adds only the missing system_engineer and maintenance roles
--   • adds audit context columns without changing existing action semantics
--   • does not provision users, credentials, sessions, or emergency keys

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Granular permissions used by the existing operations surface and the
--    newly introduced staff role definitions.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permissions" ("id", "name", "description") VALUES
  ('perm_audit_read',          'audit.read',          'Read operational audit entries'),
  ('perm_staff_read',          'staff.read',          'Read internal staff assignments'),
  ('perm_staff_roles_manage',  'staff.roles.manage',  'Assign and remove internal staff roles'),
  ('perm_system_health_read',  'system.health.read',  'Read system health information'),
  ('perm_system_logs_read',    'system.logs.read',    'Read system operational logs'),
  ('perm_maintenance_manage',  'system.maintenance.manage', 'Manage approved maintenance controls')
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Missing staff categories. Existing equivalents are intentionally reused:
--    owner = Super Admin, system_admin = Admin, and the existing team roles
--    remain the canonical Customer Support / Verification / Moderation roles.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "roles" ("id", "name", "description") VALUES
  ('role_system_engineer', 'system_engineer', 'System engineer — health and operational diagnostics'),
  ('role_maintenance',     'maintenance',     'Maintenance staff — approved maintenance controls')
ON CONFLICT ("id") DO NOTHING;

-- The existing broad administrator keeps its current capabilities and gains
-- explicit names for staff/audit administration. No existing permission is
-- removed or renamed.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.name IN (
  'audit.read',
  'staff.read',
  'staff.roles.manage'
)
WHERE r.name IN ('owner', 'system_admin')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON (
  (r.name = 'system_engineer' AND p.name IN ('system.health.read', 'system.logs.read', 'audit.read'))
  OR
  (r.name = 'maintenance' AND p.name IN ('system.health.read', 'system.maintenance.manage'))
)
WHERE r.name IN ('system_engineer', 'maintenance')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Additive audit context. Existing rows remain valid and are treated as
--    successful events with unavailable context.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "ops_audit_log"
  ADD COLUMN IF NOT EXISTS "actor_clerk_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_roles" TEXT,
  ADD COLUMN IF NOT EXISTS "required_permission" TEXT,
  ADD COLUMN IF NOT EXISTS "clerk_session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
  ADD COLUMN IF NOT EXISTS "user_agent" TEXT,
  ADD COLUMN IF NOT EXISTS "success" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "error_code" TEXT;

CREATE INDEX IF NOT EXISTS "ops_audit_log_clerk_session_idx"
  ON "ops_audit_log" ("clerk_session_id");
CREATE INDEX IF NOT EXISTS "ops_audit_log_request_idx"
  ON "ops_audit_log" ("request_id");
CREATE INDEX IF NOT EXISTS "ops_audit_log_success_idx"
  ON "ops_audit_log" ("success");