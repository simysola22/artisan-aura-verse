---
name: PMP current state
description: What is implemented and what remains in the PMP marketplace project.
---

## Done
- Full jobs marketplace: schema, backend routes, frontend routes (jobs, jobs/$jobId, jobs/create, jobs/$jobId/apply, jobs/$jobId/edit, jobs/applications)
- SSE realtime messaging: subscribe() wired into ConversationView via useEffect
- Message button on provider profile: navigates to /messages/$conversationId (not generic /messages)
- Profile editing: account.tsx has full provider editor (headline, about, skills, experience, certs, portfolio) and employer editor (name, org, industry, location, website)
- Dashboard uses real API data (no DEMO_JOBS or hardcoded numbers)
- Verification system (multi-step wizard + ops queue)
- 505 backend tests pass — run with `bunx vitest run` (not `bun test`)
- Frontend TypeScript clean

## Remaining / Not yet done
- Onboarding flow: new users land in dashboard with no profile — no guided onboarding
- Public provider profiles: anonymous users may need auth to view profiles (check backend)
- Billing UI: Paystack integration exists in backend but no frontend pricing/subscription page
- Ops support tickets and moderation reports: backend exists, frontend is empty shells

## Key facts
- Backend tests must use `bunx vitest run` not `bun test` (bun uses its own test runner lacking vi.mocked)
- Both workflows running: frontend on port 5000, backend on port 3000
- DATABASE_URL and Clerk secrets needed for real auth/data flows
