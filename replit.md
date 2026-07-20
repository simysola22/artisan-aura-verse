# Precious Market Place (PMP)

A premium marketplace connecting hirers with verified artisans and professionals. Built with TanStack Start (React SSR), Tailwind CSS v4, and a separate Hono/Bun backend.

## Stack

- **Frontend:** React 19, TanStack Start (SSR), TanStack Router, TanStack Query, Tailwind CSS v4, Radix UI, shadcn/ui
- **Backend:** Hono, Bun, Drizzle ORM (PostgreSQL), Clerk Auth
- **Runtime/Package manager:** Bun

## Running the app

```bash
bun run dev        # start the frontend dev server on port 5000
```

The frontend currently runs with mock data — no backend connection required for development.

## Backend (not yet connected on Replit)

The backend lives in `backend/` with its own `package.json`. To run it you need:

- `DATABASE_URL` — PostgreSQL connection string
- `CLERK_SECRET_KEY` — Clerk server-side auth key
- `CORS_ORIGIN` — defaults to `http://localhost:5000`

Run with:
```bash
cd backend && bun run dev   # starts Hono server
```

## Project structure

```
src/
  api/          API client helpers
  components/   Shared UI components (shadcn/ui based)
  features/     Feature-scoped components and logic
  hooks/        Custom React hooks
  layouts/      Page layout components
  lib/          Utilities (error capture, etc.)
  routes/       TanStack Router file-based routes
  styles.css    Global styles / Tailwind entry
backend/
  src/
    db/         Drizzle schema and migrations
    routes/     Hono API route handlers
    config/     Environment config
```

## User preferences

- Keep the existing project structure and stack — do not restructure or migrate it.
