---
name: PMP project setup
description: Key facts about the Precious Market Place (PMP) project setup and development workflow
---

# Precious Market Place (PMP)

**Why:** Multi-session development — need to remember architecture decisions and workflow state.

## Stack
- TanStack Start + React 19, Bun, Tailwind CSS v4, shadcn/ui, TanStack Router (file-based)
- Dev server: `bun run dev` → port 5000 (host 0.0.0.0, configured in vite.config.ts)
- @lovable.dev/vite-tanstack-config forces host `::` (IPv6) by default — overridden via `vite: { server: { host: "0.0.0.0", port: 5000 } }` passed to its defineConfig. Non-sandbox path uses mergeConfig(defaults, userConfig) so user wins.
- Status: frontend complete, mock-backed; backend not started

## Themes (5 total)
light, dark (default), midnight, sunrise, ocean — all in src/styles.css via `data-theme` attribute on `<html>`.
Theme type union in `src/features/theme/theme-context.tsx`, toggle in `src/features/theme/theme-toggle.tsx`.
To add a theme: add CSS block in styles.css, add value to Theme union, add entry in theme-toggle options array.

## Architecture rules
- Feature components → src/api/*.ts only (never src/api/mock directly)
- Mock adapter in src/api/mock/ — only domain API files may import it
- No hardcoded colors in components — add tokens to src/styles.css first
- API contracts: src/api/contracts.md (source of truth, do not drift)
- Handoff doc: docs/frontend-handoff.md

## Phase status
- Phase 1 (understand): done
- Phase 2 (frontend changes): done — Sunrise + Ocean themes added, full rebrand to PMP
- Phase 3 (frontend audit): done — all checks pass, BACKEND READY verdict issued
- Phase 4 (backend foundation): not started
- Phase 5 (backend features): not started

## Backend implementation order (from spec)
Stage 1: Foundation (config, DB, migrations, logging, error handling, health checks, security)
Stage 2: Auth (register, login, logout, /auth/me, refresh, recovery, reset)
Stage 3: Reference data (categories, skills)
Stage 4: Providers and employers (profiles, skills, experience, certs, portfolio)
Stage 5: Verification (submission, status, review workflow)
Stage 6: Search (search, filtering, pagination, ranking)
Stage 7: Messaging (conversations, messages, realtime transport)

**How to apply:** Read docs/frontend-handoff.md §11 and src/api/contracts.md before any backend work. Backend must implement the contract exactly — no silent drift.
