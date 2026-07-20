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
- Stage 5 — Search & Ranking: COMPLETE
- Stage 7 — Messaging: COMPLETE

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

**Stage 5 key decisions:**
- Bounded candidate fetch (500) ranked in app layer; `total` from separate COUNT query (accurate)
- Text search: PostgreSQL ILIKE on headline/about/location — swappable with Meilisearch via repository only
- Ranking: pure functions in `ranking.ts` — no DB, fully testable independently
- `sort: "rating"` → `"relevance"` (ratings not yet built); `"recent"` → `"newest"` (frontend alias)
- `id` in public response = profile ID (matches /providers/:id routing)
- `exactOptionalPropertyTypes: true` — use conditional spreads (`...(x ? {k:x} : {})`) not `{k: undefined}` when building SearchQuery
- Migration `0004_search_indexes.sql`: 3 new indexes (skill_id reverse lookup, location partial, years_experience partial)

**Stage 7 key decisions:**
- Realtime transport: SSE (`GET /v1/messaging/conversations/:id/stream`) not WebSocket — simpler, standard HTTP
- `PubSub` interface backed by `InMemoryPubSub` singleton; Redis adapter can be swapped for multi-instance deployments without touching routes/services
- `participant_hash` (sorted user IDs joined with `:`) on `conversations` with UNIQUE constraint — race-safe duplicate prevention at DB level; service catches `23505` and falls back to existing row
- Soft deletes on messages: `deleted_at` timestamp; body replaced with `""` in DTO — row kept for audit/moderation
- Blocks are directional: `user_blocks(blocker_id, blocked_id)`; service checks both directions before allowing send
- Sender ID always from `c.var.auth.pmpUserId`, never from request body — IDOR prevention
- `exactOptionalPropertyTypes` gotcha: `lt(date, column)` is wrong argument order — use `gt(column, date)` for "column after date"
- Test `res.json()` returns `unknown` — must cast to `Record<string, unknown>` for property access under strict TS
- All messaging endpoints require `messaging.use` permission (already seeded for employer + provider roles)
- Migration `0005_messaging_system.sql`: 5 tables (conversations, conversation_participants, messages, message_reports, user_blocks) + 2 enums + indexes

**Frontend:** Mock-backed; does not require backend to run (`bun run dev` in root)
