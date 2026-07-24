---
name: PMP current state
description: Current implementation state of the PMP project after Phase 1 + audit-context completeness work
---

## Status after support-message audit fix

- Backend typecheck: ✅ clean
- Frontend typecheck: ✅ clean
- Backend tests: ✅ 514/514 passing
- Production frontend build: ✅ succeeds

## Phase 1 changes (previous session)

**Root cause fixed:** `sessionId` was declared with `const` inside a `try {}` block in `auth.ts` — caused ReferenceError on every authenticated route. Fixed by declaring `let sessionId: string | undefined` before the try block.

**RBAC extended:** `ASSIGNABLE_ROLES_BY_ACTOR` in `services/ops/users.ts` includes `role_system_engineer` and `role_maintenance` as owner-assignable roles.

**Migration journal fixed:** `0008_job_marketplace` was missing from the journal; fixed to idx 8, `0009_staff_control_foundation` moved to idx 9.

## Audit-context completeness pass

### Fully fixed (routes now pass buildAuditContext):
- `POST /v1/ops/support/tickets` → `createTicket` (no required permission)
- `POST /v1/ops/support/tickets/:id/assign` → `assignTicket` (support.manage)
- `POST /v1/ops/support/tickets/:id/close` → `closeTicket` (support.respond)
- `POST /v1/ops/moderation/reports` → `submitReport` (no required permission)
- `POST /v1/ops/moderation/reports/:id/review` → `markReportReviewing` (moderation.review)
- `POST /v1/ops/moderation/reports/:id/action` → `takeModerationAction` (moderation.action)

### Critical bug fixed:
`takeModerationAction` in `services/ops/moderation.ts` was spreading `auditContext` inside the `metadata: {}` object literal instead of at the top level of `appendOpsAudit` params. All seven attribution columns were being silently buried in the JSON blob. Fixed to spread at top level.

### buildAuditContext updated:
`requiredPermission` made optional — routes with no permission gate (any-auth-user routes) now omit it cleanly.

## Support-message audit fix

`addMessage` (`POST /v1/ops/support/tickets/:id/messages`) now writes
`support_ticket_message_added` with the existing audit context. The additive
`0010_support_ticket_message_audit` migration adds the enum value.

## Fully audited actions
suspendUser, reactivateUser, deleteUser, assignRole, removeRole, createTicket, addMessage, assignTicket, closeTicket, submitReport, markReportReviewing, takeModerationAction

## What NOT yet implemented (by design)
- Admin/Super Admin dashboard or UI
- Credentials, keys, or provisioned staff accounts
- Staff onboarding procedure
