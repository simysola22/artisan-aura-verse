---
name: Stage 9 Operations System
description: What was implemented in Stage 9 and key security invariants enforced
---

## What was built

Migration `0007_operations.sql` adds 5 new tables:
- `support_tickets` + `support_ticket_messages`
- `content_reports` + `moderation_actions` (append-only)
- `ops_audit_log` (append-only cross-domain audit trail)

Services in `backend/src/services/ops/`:
- `users.ts` — list, suspend, reactivate, delete, assignRole, removeRole, listRoles
- `support.ts` — createTicket, listTickets, getOwnTickets, getTicket, addMessage, assignTicket, closeTicket
- `moderation.ts` — submitReport, listReports, getReport, markReportReviewing, takeModerationAction
- `audit.ts` — appendOpsAudit (never throws), listOpsAudit

Routes in `backend/src/routes/ops.ts` (createOpsRouter factory), mounted in app.ts under /v1/ops/*.

## Security invariants enforced at the service layer

**Why:** Privilege escalation is catastrophic in an ops system.

- Self-escalation blocked: users cannot assign roles to themselves
- Privilege escalation blocked: system_admin cannot assign owner or system_admin roles (ASSIGNABLE_ROLES_BY_ACTOR map)
- Privilege hierarchy enforced: actors cannot manage users of equal/higher privilege (PRIVILEGE numeric map: owner=100, system_admin=80, team roles=40, employer/provider=10)
- Self-suspension blocked at service layer with BadRequestError
- Internal support messages (is_internal=true) filtered server-side based on support.respond permission

## appendOpsAudit is fire-and-forget
Catches and logs errors to stderr instead of throwing — audit failures never break primary operations.

## Test state
18 test files, 505 tests, all passing after Stage 9 commit.
