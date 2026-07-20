---
name: PMP project setup
description: Precious Market Place — stack, architecture, run instructions, and mobile polish status
---

# PMP — Precious Market Place

## Architecture
- **Frontend:** TanStack Start + React 19, Vite, Tailwind v4, Radix UI (shadcn style), five themes (light/dark/midnight/sunrise/ocean)
- **Backend:** Hono + Bun + Drizzle ORM + PostgreSQL (in `backend/` directory)
- **Auth:** Clerk (frontend: `VITE_CLERK_PUBLISHABLE_KEY`, backend: `CLERK_SECRET_KEY`)
- **Deploy targets:** Vercel (frontend), Render (backend), Railway (DB) — NOT Replit
- **Replit is dev-only** — do NOT add @replit/* packages, REPLIT_* vars, or Replit-specific APIs

## Running on Replit
- `bun install` from root to install frontend deps
- `bun run dev` — frontend on port 5000 in mock mode (no backend/DB required)
- Backend needs `DATABASE_URL` + `CLERK_SECRET_KEY` to run (not yet wired on Replit)

## Backend stage status
- Stages 1–8: COMPLETE
- Stage 9 (Operations): NOT STARTED — do not begin

## Mobile UI polish — COMPLETE (July 2026)
Applied in this session starting from clean Stage 8 state (previous environment's polish work was never committed).

**Why:** Previous environment ran out of quota before committing.

**Files changed:**
- `src/styles.css` — `--radius` bumped `0.75rem` → `1rem` in light, sunrise, ocean themes (dark/midnight inherit)
- `src/components/ui/button.tsx` — `rounded-md` → `rounded-lg`, `h-9` → `h-10` default, `lg` size `h-12 rounded-xl`
- `src/components/ui/input.tsx` — `h-9 rounded-md` → `h-11 rounded-lg`
- `src/components/ui/card.tsx` — `rounded-xl` → `rounded-2xl`; responsive padding `p-5 sm:p-6`
- `src/components/ui/dialog.tsx` — `sm:rounded-lg` → always `rounded-2xl`; mobile width `w-[calc(100%-2rem)]`
- `src/layouts/AuthShell.tsx` — GlassPanel `p-8` → `p-5 sm:p-8`
- `src/layouts/PublicShell.tsx` — glass top bar, `min-h-14` nav items, safe-area bottom padding via `env(safe-area-inset-bottom)`
