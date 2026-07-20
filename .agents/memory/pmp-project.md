---
name: PMP project setup
description: Precious Market Place — stack, architecture, and stage progress
---

# PMP (Precious Market Place)

**Stack:** TanStack Start + React 19, Bun, Tailwind v4, Hono backend, Drizzle ORM, PostgreSQL, Clerk auth

**Production architecture (not Replit):**
- Vercel → Frontend
- Render → Backend API
- Railway → PostgreSQL
- Clerk → Authentication

**Stages:**
- Stage 1 — Backend Foundation: COMPLETE
- Stage 2 — Clerk + Identity + Authorization: COMPLETE
- Stage 3 — Core Domain & Profiles: COMPLETE
- Stage 4 — Verification System: COMPLETE
- Stage 5 — Search & Ranking: NOT STARTED
- Stage 6 — Messaging: NOT STARTED

**Do NOT use:** Replit Database, Replit Auth, Replit SDKs, REPLIT_* env vars

**Stage 4 key decisions:**
- Status transitions centralised in `ALLOWED_TRANSITIONS` map in `services/verification.ts` — testable without DB
- Evidence stored as URL references only — no binary in PostgreSQL; `storage_key` column enables storage provider migration
- Internal notes in separate table (`verification_notes`) — cannot accidentally be included in provider queries
- Audit log is append-only from application perspective
- Provider profile `verification_status` always derived from case (single source of truth via `syncProfileStatus()`)
- Future AI provider can use same service functions — no schema change needed

**Permissions (already seeded in migration 0001):**
- `verification.submit` — providers
- `verification.read`, `verification.review`, `verification.request_info`, `verification.approve`, `verification.reject` — verification_team
- `verification.manage` — system_admin

**Frontend:** Mock-backed; does not require backend to run (`bun run dev` in root)
