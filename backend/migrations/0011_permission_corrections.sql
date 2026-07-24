-- PMP Phase 1 — Permission model corrections
--
-- Additive-only migration:
--   • Adds genuinely missing permissions (audit.export, sessions.view, sessions.revoke)
--   • Assigns new permissions to the appropriate roles
--   • Does NOT rename, remove, or alter any existing permission, role, or table
--   • Does NOT provision users, credentials, or sessions

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New permissions
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "permissions" ("id", "name", "description") VALUES
  ('perm_audit_export',    'audit.export',    'Export operational audit entries'),
  ('perm_sessions_view',   'sessions.view',   'View active session information'),
  ('perm_sessions_revoke', 'sessions.revoke', 'Revoke active sessions')
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Assign new permissions to roles
--
-- audit.export  → owner, system_admin only (sensitive data export)
-- sessions.view → owner, system_admin (investigation capability)
-- sessions.revoke → owner only (destructive — forces logout)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.name IN ('audit.export', 'sessions.view')
WHERE r.name IN ('owner', 'system_admin')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.name = 'sessions.revoke'
WHERE r.name = 'owner'
ON CONFLICT DO NOTHING;
