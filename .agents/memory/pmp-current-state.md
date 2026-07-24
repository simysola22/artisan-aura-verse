---
name: PMP current state
description: Current implementation state of the PMP project after Phase 1 permission corrections
---

## Status after Phase 1 permission corrections

- Backend typecheck: ✅ clean
- Frontend typecheck: ✅ clean
- Backend tests: ✅ 516/516 passing
- Production frontend build: ✅ succeeds
- Migration journal: ✅ entries 0000–0011 synchronized

## Phase 1 changes (this session)

### Routes fixed (backend/src/routes/ops.ts)
- `GET /v1/ops/audit` now requires `audit.read` (was: `system.manage`)
  — system_engineers now have correct access; no functional change for owner/system_admin
- `GET /v1/ops/roles` now requires `staff.read` (was: `system.manage`)
  — same rationale

### Service layer (backend/src/services/ops/users.ts)
- Added `ROLE_PRIVILEGE` map: `{ role_system_engineer: 60, role_maintenance: 55 }`
- Added `effectivePrivilege(accountType, roleIds)` helper — returns max of PRIVILEGE[accountType] and any ROLE_PRIVILEGE
- `assertActorOutranksTarget` now accepts optional `targetRoleIds` and uses `effectivePrivilege`
- `assignRole` loads target's current roles and passes them to privilege check
- `removeRole` loads target's current roles, passes them to privilege check, AND guards against last-owner removal (throws ForbiddenError if roleId === 'role_owner' and ownerCount <= 1)
- Added `count` to drizzle-orm imports

### Migration added (0011_permission_corrections.sql)
- New permissions: `audit.export` (perm_audit_export), `sessions.view` (perm_sessions_view), `sessions.revoke` (perm_sessions_revoke)
- `audit.export` → owner, system_admin
- `sessions.view` → owner, system_admin
- `sessions.revoke` → owner only (destructive)

### Tests updated (backend/tests/ops.test.ts)
- Default identity now includes: staff.read, staff.roles.manage, audit.read (in addition to existing permissions)
- Test descriptions updated for roles (system.manage → staff.read) and audit (system.manage → audit.read)
- New test: system_engineer identity with audit.read but not system.manage can access GET /v1/ops/audit
- New test: last-owner removal returns 403

## Fully audited actions (unchanged)
suspendUser, reactivateUser, deleteUser, assignRole, removeRole, createTicket, addMessage, assignTicket, closeTicket, submitReport, markReportReviewing, takeModerationAction

## Privilege hierarchy (after Phase 1)
- owner (account_type): 100
- system_admin (account_type): 80
- role_system_engineer (role only, not account_type): 60
- role_maintenance (role only, not account_type): 55
- verification/support/moderation_team (account_type): 40
- employer/provider (account_type): 10

## What NOT yet implemented (by design)
- Clerk server-side session revocation routes (sessions.revoke permission exists, route TBD)
- Verification management ops routes (/v1/ops/verification/*)
- Staff listing route (/v1/ops/staff)
- Maintenance mode controls
- Admin Control Center frontend UI (ops pages are mock-backed)
- Staff onboarding procedure

## Environment secrets status (Replit)
- SESSION_SECRET: ✅ present
- CLERK_SECRET_KEY: ❌ missing (needed for backend to run)
- CLERK_PUBLISHABLE_KEY: ❌ missing (needed for frontend Clerk auth)
- DATABASE_URL: ⚠️ runtime-managed by Replit (may conflict with Railway DB — user must check)
- CORS_ORIGIN: ❌ missing (defaults to http://localhost:5000 in dev)
- PAYSTACK_SECRET_KEY: ❌ missing (optional — only needed for payment operations)
