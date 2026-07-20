# Precious Market Place (PMP)

A premium marketplace for hiring verified artisans and professionals. Built with TanStack Start (React 19, SSR), Tailwind CSS v4, and a separate Hono/Bun backend.

## How to run

**Frontend (this project):**
```
bun install
bun run dev        # starts Vite dev server on port 5000
```

The frontend runs with mock data and does not require the backend to be running.

## Stack

- **Frontend/SSR:** React 19, TanStack Start, TanStack Router, TanStack Query, Tailwind CSS v4, Shadcn/UI (Radix), Vite 8
- **Backend (separate, in `backend/`):** Hono, Bun, Drizzle ORM, PostgreSQL, Clerk (auth), Pino

## Environment variables

### Backend (`backend/`)
| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://localhost:5432/pmp_dev` |
| `CLERK_SECRET_KEY` | Clerk backend API key | *(required)* |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:5000` |
| `NODE_ENV` | `development` or `production` | — |

### Frontend
Clerk public keys (VITE_* prefix) are needed when enabling real authentication.

## Running the backend

```
cd backend
bun install
bun run db:generate   # generate Drizzle migrations
bun run db:migrate    # apply migrations
bun run dev           # start Hono API server
```

## User preferences
