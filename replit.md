# Precious Market Place (PMP)

A premium service marketplace platform connecting hirers with verified artisans and professionals. Built with TanStack Start + React, Tailwind CSS v4, shadcn/ui glass components, and Bun.

## How to run

```bash
bun install
bun run dev
```

The dev server starts on port 5000 (configured in `vite.config.ts`). The app runs fully in mock mode by default — no backend required.

## Architecture

Feature-based, transport-agnostic, mock-backed. Layer boundaries are enforced by directory:

```
UI primitives     →  src/components/ (ui/, glass/, common/)
Feature modules   →  src/features/   (auth, theme, providers)
Layouts (shells)  →  src/layouts/    (PublicShell, OpsShell, AuthShell)
Routes (pages)    →  src/routes/     (file-based, TanStack Router)
Domain API        →  src/api/*.ts    (per-domain façade)
Mock adapter      →  src/api/mock/   (only src/api/* may import this)
Domain types      →  src/types/      (single source of truth)
```

## Theme system

Five themes, selected via `data-theme` on `<html>`:

| Value | Description |
|-------|-------------|
| `light` | Neutral warm-light (default fallback) |
| `dark` | Deep crimson-dark |
| `midnight` | Deep indigo-midnight |
| `sunrise` | Warm golden-hour bright |
| `ocean` | Cool azure bright |

Theme is persisted in `localStorage` under key `mp.theme`. To add more themes: add a CSS block in `src/styles.css`, add the value to the `Theme` union in `src/features/theme/theme-context.tsx`, and add an entry in `src/features/theme/theme-toggle.tsx`.

## Environment variables

| Name | Default | Purpose |
|------|---------|---------|
| `VITE_API_BASE_URL` | `""` (empty → mock) | Base URL of the real backend |
| `VITE_USE_MOCK_API` | `"false"` | Force mock even when a base URL is set |

## Key docs

- `docs/frontend-handoff.md` — full architecture, auth wiring, known limitations, backend to-do list
- `src/api/contracts.md` — API contract (source of truth for all endpoints)
- `src/routes/README.md` — routing conventions

## Status

Frontend: complete (mock-backed). Backend: not started.

See `docs/frontend-handoff.md` §11 for the recommended backend implementation order.

## User preferences

- Official product name: **Precious Market Place (PMP)**. Short form: **PMP**. Never "Precious Marketplace" or other variants.
- Keep the existing frontend architecture — do not restructure or migrate it.
- Follow the phased development order in the PMP spec: frontend changes → audit → backend foundation → backend features.
