# PMP — Precious Market Place

A full-stack professional services marketplace connecting employers/hirers with providers/artisans.

## Stack

- **Frontend:** TanStack Start + React 19 + Vite + Tailwind CSS v4 + Radix UI (shadcn-style components)
- **Backend:** Hono + Bun + Drizzle ORM + PostgreSQL
- **Auth:** Clerk (frontend: `VITE_CLERK_PUBLISHABLE_KEY`, backend: `CLERK_SECRET_KEY`)
- **Payments:** Paystack (backend only: `PAYSTACK_SECRET_KEY`)
- **Testing:** Vitest (backend)

## Running on Replit

Both workflows start automatically:

| Workflow | Command | Port |
|---|---|---|
| Start application | `bun run dev` (Vite) | 5000 |
| Start backend | `cd backend && bun run dev` | 3000 |

In development, Vite proxies `/v1/*` to `http://localhost:3000` automatically — no `VITE_API_BASE_URL` needed locally.

### Without real secrets

The frontend runs in **mock mode** (in-memory data, no backend) when `VITE_API_BASE_URL` is empty and no Clerk key is set. All core UI is explorable in this mode.

## Required Environment Variables

### Frontend (Vite `define` injects these — no `VITE_` prefix needed in Replit secrets)

| Variable | Used in | Description |
|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | `vite.config.ts` → `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. Get from Clerk dashboard → API Keys. |
| `VITE_API_BASE_URL` | `src/api/client.ts` | Backend URL in production (e.g. `https://your-backend.com`). Leave empty in dev (Vite proxy handles it). |

### Backend (`backend/.env` or Replit secrets)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname` |
| `CLERK_SECRET_KEY` | **Yes** | Clerk secret key for JWT verification. Get from Clerk dashboard → API Keys. |
| `CORS_ORIGIN` | Yes | Frontend origin for CORS. Default: `http://localhost:5000`. In production: your frontend URL. |
| `PAYSTACK_SECRET_KEY` | For billing | Paystack secret key. Get from Paystack dashboard → Settings → API Keys. |
| `PAYSTACK_WEBHOOK_SECRET` | For billing webhooks | Paystack webhook secret for signature verification. |

### Optional backend variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend HTTP port |
| `NODE_ENV` | `development` | `production` in deployed environments |
| `REDIS_URL` | — | Redis URL for rate limiting and caching (future) |
| `STORAGE_DRIVER` | `local` | `local` or `s3` for file storage |
| `EMAIL_DRIVER` | `console` | `console` (logs to stdout) or `smtp` |

## Running database migrations

```bash
cd backend && bun run db:migrate
```

This runs all migrations in `backend/migrations/` in order. Safe to re-run — idempotent.

## Running backend tests

```bash
cd backend && bunx vitest run
```

**Important:** Use `bunx vitest run`, NOT `bun test` — Bun's native test runner lacks `vi.mocked` support needed by the test suite.

## Project structure

```
├── src/                    # TanStack Start frontend
│   ├── routes/             # File-based routes (auto-discovered)
│   ├── api/                # API client functions (real + mock adapters)
│   ├── features/           # Feature modules (auth, dashboard, providers, theme)
│   ├── components/         # Shared UI components
│   └── layouts/            # Shell layouts (PublicShell, OpsShell)
├── backend/
│   ├── src/
│   │   ├── routes/         # Hono route handlers
│   │   ├── services/       # Business logic
│   │   ├── db/             # Drizzle schema + migrations runner
│   │   └── middleware/     # Auth, CORS, rate limiting, logging
│   ├── migrations/         # SQL migration files (0000–0008)
│   └── tests/              # Vitest test suite (505 tests)
└── docs/                   # Architecture documentation
```

## Key routes

| Route | Access | Description |
|---|---|---|
| `/` | Public | Landing page |
| `/dashboard` | Auth | Role-aware workspace |
| `/onboarding` | Auth (new users) | Profile setup wizard |
| `/search` | Public | Provider discovery with filters + pagination |
| `/jobs` | Public | Job listings |
| `/jobs/create` | Employer only | Post a new job |
| `/jobs/applications` | Provider only | Track my applications |
| `/messages` | Auth | Conversations |
| `/account` | Auth | Profile editing |
| `/verification` | Provider only | Verification case submission |
| `/billing` | Auth | Subscription plans + Paystack checkout |
| `/ops/*` | Ops role only | Admin: verification queue, moderation, support, users |

## User preferences

- Do not add `@replit/*` packages, `REPLIT_*` env vars, or Replit-specific APIs — this project targets Vercel (frontend) / Render (backend) / Railway (DB) for deployment.
- Use `bunx vitest run` for backend tests, never `bun test`.
