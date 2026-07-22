# PMP — Precious Market Place

A premium marketplace connecting hirers with verified artisans and professionals. Built with TanStack Start (React 19) on the frontend and Hono/Bun on the backend.

## Stack

- **Frontend**: TanStack Start, React 19, Vite, Tailwind CSS v4, Radix UI / Shadcn components
- **Backend**: Hono, Bun, Drizzle ORM, PostgreSQL, Clerk (auth), Pino (logging)
- **Runtime**: Bun

## Running on Replit

Two workflows run in parallel:

| Workflow | Command | Port |
|---|---|---|
| Start application | `bun run dev` | 5000 |
| Start backend | `cd backend && bun run dev` | 3000 |

The frontend has a **mock API mode** — it works without a live backend when `VITE_API_BASE_URL` is unset.

## Environment variables / secrets

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Backend | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Backend | Clerk server-side key |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend | Clerk publishable key |
| `VITE_API_BASE_URL` | Frontend | Backend URL (leave unset for mock mode) |
| `SESSION_SECRET` | Backend | Session signing secret |

Optional: Redis (`REDIS_URL`), S3 (`S3_*`), SMTP (`SMTP_*`) — only needed for those drivers.

## Database

```bash
cd backend && bun run db:migrate   # run migrations
cd backend && bun run db:generate  # generate migrations from schema changes
```

## User preferences

- Keep the project's existing structure and stack.
