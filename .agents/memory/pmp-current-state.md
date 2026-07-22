---
name: PMP current state
description: What is implemented and what remains in the PMP marketplace project.
---

## Done
- Full jobs marketplace: schema, backend routes, frontend routes (jobs, jobs/$jobId, jobs/create, jobs/$jobId/apply, jobs/$jobId/edit, jobs/applications)
- SSE realtime messaging: subscribe() wired into ConversationView via useEffect
- Message button on provider profile: navigates to /messages/$conversationId (not generic /messages)
- Profile editing: account.tsx has full provider editor (headline, about, skills, experience, certs, portfolio) and employer editor (name, org, industry, location, website)
- Dashboard uses real API data (no DEMO_JOBS or hardcoded numbers). "Active jobs" stat uses real jobsApi.listJobs count.
- Verification system (multi-step wizard + ops queue). providerKind no longer hardcoded to "artisan" — uses user's actual kind.
- 505 backend tests pass — run with `bunx vitest run` (not `bun test`)
- Frontend TypeScript clean, production build passes
- Onboarding route (/onboarding): new users without profiles are redirected here from dashboard
- Billing page (/billing): lists plans from backend, handles Paystack checkout redirect, shows payment history
- Ops Overview (/ops): uses real opsApi.getOverview() — no more hardcoded stats
- Ops Users (/ops/users): uses real /v1/ops/users API with filters, suspend/reactivate actions
- Search: real location filter (text input, not hardcoded "London"), pagination added
- Nav: Billing & Plans link in both desktop AccountMenu and mobile dropdown

## Remaining / Not yet done
- Onboarding flow: new users land in dashboard with no profile — no guided onboarding
  → FIXED: /onboarding route created, dashboard detects missing profile and redirects
- Ops support tickets and moderation reports: backend exists, frontend is empty shells
  → FIXED: both pages fully wired to real API
- Billing UI: Paystack integration exists in backend but no frontend pricing/subscription page
  → FIXED: /billing route created
- File uploads for verification evidence: URL-based evidence supported; binary upload requires S3 setup

## Key facts
- Backend tests must use `bunx vitest run` not `bun test` (bun uses its own test runner lacking vi.mocked)
- Both workflows running: frontend on port 5000, backend on port 3000
- DATABASE_URL and Clerk secrets needed for real auth/data flows
- Vite dev proxy handles /v1/* → localhost:3000; no VITE_API_BASE_URL needed locally
- In mock mode (no VITE_API_BASE_URL), onboarding profile check resolves to null (mock employer profile returns non-null), so onboarding skips correctly
