---
name: PMP project setup
description: Precious Market Place — stack, layout, backend stages 1-3 complete status
---

# PMP Project

## Frontend
- TanStack Start + React, Bun, Tailwind v4, five themes
- Mock-backed; `VITE_API_BASE_URL` and `VITE_USE_MOCK_API` gate real vs mock
- Frontend workflow: `bun run dev` on port 5000

## Backend (Stage 3 — complete)
- Lives in `backend/` with its own `package.json`
- Hono v4 (HTTP), Drizzle ORM + postgres-js (DB), pino (logging), Zod (config validation), Vitest (tests)
- Run: `cd backend && bun run dev` — starts on port 3000
- Tests: `bun run test` — 165 tests, 13 suites, all pass
- TypeScript: clean (`tsc --noEmit`), Lint: clean (`eslint src tests`)
- NO Replit-specific dependencies

## Stage 3 additions
- `backend/migrations/0002_core_domain.sql` — 5 enums, 8 tables, 10 categories, ~50 skills seeded
- `backend/src/db/schema/profiles.ts` — Drizzle schema for all Stage 3 tables
- `backend/src/services/reference.ts` — getCategories, getSkills
- `backend/src/services/provider-profile.ts` — full CRUD + sub-resources, completeness scoring
- `backend/src/services/employer-profile.ts` — full CRUD, completeness scoring
- `backend/src/routes/reference.ts` — GET /v1/reference/categories, GET /v1/reference/skills
- `backend/src/routes/providers.ts` — 9 routes: profile CRUD + experience/certs/portfolio + public view
- `backend/src/routes/employers.ts` — 3 routes: employer profile CRUD

## Completeness scoring
- Provider: headline(15) + about(15) + category(10) + skills(10) + experience(15) + location(10) + availability(5) + portfolio(10) + certs(10) = 100
- Employer: displayName(20) + description(25) + industry(15) + location(20) + website(10) + logo(10) = 100

## Auth pattern
- `requireClerkAuth` = full identity required (most domain routes)
- `requireClerkTokenOnly` = Clerk token only (sync route)
- Account-type guard: assertProvider/assertEmployer in route handlers throw ForbiddenError

## Testing pattern
- Service mocks via `vi.mock("../src/services/X.js", () => ({ fn: vi.fn() }))` — avoids complex DB chain mocking
- `createApp({ db })` — inject mock db for DB-level tests (reference routes)
- `exactOptionalPropertyTypes: true` in tsconfig — route handlers must cast Zod body as ServiceParamType

## Key files
- `backend/src/app.ts` — accepts `db?` in AppOptions; mounts all domain routers
- `backend/src/errors/index.ts` — AppError hierarchy
- `docs/backend-architecture.md` — full architecture doc

**Why:** Scope follows Stage 3 brief in attached_assets; profiles are separate entities from users to allow dual-profile in future without migrations.
