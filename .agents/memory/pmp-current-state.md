---
name: PMP current state
description: Current implementation state of the PMP project after Phase 1 staff-control foundation completion
---

## Status after Phase 1 staff-control foundation

- Backend typecheck: ✅ clean
- Frontend typecheck: ✅ clean
- Backend tests: ✅ 507/507 passing
- Production frontend build: ✅ succeeds

## Phase 1 changes (this session)

**Root cause fixed:** `sessionId` was declared with `const` inside a `try {}` block in `auth.ts` but referenced outside it — caused ReferenceError on every authenticated route (212 test failures). Fixed by declaring `let sessionId: string | undefined` before the try block.

**Audit context wired:** `backend/src/routes/ops.ts` now passes full `AuditContext` (clerkUserId, sessionId, requestId, roleNames, requiredPermission, ip, userAgent) to all mutating user-management service calls (suspend, reactivate, delete, assignRole, removeRole).

**RBAC extended:** `ASSIGNABLE_ROLES_BY_ACTOR` in `services/ops/users.ts` now includes `role_system_engineer` and `role_maintenance` as owner-assignable roles.

**Migration journal fixed:** `backend/migrations/meta/_journal.json` — `0008_job_marketplace` was missing from the journal (0009 was registered as idx 8). Fixed to: idx 8 = `0008_job_marketplace`, idx 9 = `0009_staff_control_foundation`.

## Migration state
- Migration 0009 (`0009_staff_control_foundation.sql`) was already written by previous environment
- DB schema already had all audit context columns (actor_clerk_user_id, actor_roles, required_permission, clerk_session_id, request_id, ip_address, user_agent, success, error_code)
- Audit service (audit.ts) already had AuditContext interface and AppendAuditParams
- Request-ID middleware already existed
- Clerk adapter already extracted sessionId from `sid` claim

## What NOT yet implemented (by design)
- Admin/Super Admin dashboard
- Credentials, keys, or provisioned staff accounts
- `system_engineer` / `maintenance` account_type enum values (these are roles only, not account types)
- Audit wiring for support/moderation routes (service layer accepts auditContext but routes don't pass it yet — Phase 2 scope)
