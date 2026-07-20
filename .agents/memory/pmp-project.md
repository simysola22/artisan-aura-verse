---
name: PMP project setup
description: Precious Market Place — stack, layout, backend Stage 1 foundation status
---

# PMP Project

## Frontend
- TanStack Start + React, Bun, Tailwind v4, five themes
- Mock-backed; `VITE_API_BASE_URL` and `VITE_USE_MOCK_API` gate real vs mock
- Frontend workflow: `bun run dev` on port 5000

## Backend (Stage 1 — complete)
- Lives in `backend/` with its own `package.json`
- Hono v4 (HTTP), Drizzle ORM + postgres-js (DB), pino (logging), jose (JWT), Zod (config validation), Vitest (tests)
- Run: `cd backend && bun run dev` — starts on port 3000
- Tests: `bun run test` — 34 tests, 5 suites, all pass
- TypeScript: clean (`tsc --noEmit`)
- Lint: clean (`eslint src tests`)
- NO Replit-specific dependencies

## Key files
- `backend/src/config/index.ts` — Zod-validated env config (JWT_SECRET required, min 32 chars)
- `backend/src/app.ts` — Hono app factory used by both server and tests
- `backend/src/main.ts` — entry point with graceful shutdown (SIGTERM/SIGINT)
- `backend/src/errors/index.ts` — AppError hierarchy → contract error shape
- `backend/src/middleware/rate-limit.ts` — RateLimitStore interface (in-memory for dev)
- `backend/src/lib/{cache,storage,email}.ts` — replaceable abstractions
- `docs/backend-architecture.md` — full architecture doc
- `.env.example` — all env vars documented
- `Dockerfile` + `docker-compose.yml` — portable container setup

## What's NOT in Stage 1
- No auth endpoints (middleware only)
- No domain routes (providers, search, messaging, etc.)
- Redis/S3/SMTP drivers stubbed (throw on use)
- In-memory rate-limit/cache not suitable for multi-instance production

**Why:** Scope limit — Stage 1 is foundation only per spec in attached_assets file.
