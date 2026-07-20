# PMP Backend Architecture

Status: **Stage 1 — Foundation complete.**

This document describes the backend architecture as actually implemented.
Future capabilities that are only planned are labeled **TODO (Stage N)**.

---

## 1. Overview

The backend is a standalone HTTP API server that implements the contract
defined in `src/api/contracts.md`. The frontend communicates with it
exclusively through that contract; no implementation detail leaks across
the boundary.

```
Frontend (TanStack Start, Vite dev server)
    ↓  HTTPS  Bearer token
Backend API (Hono, Bun)
    ↓
Application services        (TODO Stage 2)
    ↓
Repositories / Drizzle ORM
    ↓
PostgreSQL
```

---

## 2. Technology stack

| Concern          | Choice              | Rationale                                          |
|------------------|---------------------|----------------------------------------------------|
| Runtime          | Bun                 | Consistent with the frontend; fast, TypeScript-native |
| HTTP framework   | Hono v4             | Portable across Bun/Node/Cloudflare; minimal; TypeScript-first |
| ORM              | Drizzle ORM         | Type-safe, version-controlled migrations, no magic  |
| Database         | PostgreSQL 16       | Specified by the project contract                  |
| DB driver        | postgres-js         | Lightweight postgres client for Bun/Node           |
| Validation       | Zod                 | Already used by the frontend; consistent schemas   |
| Auth tokens      | JWT via jose        | Portable (no native bindings); standard            |
| Logging          | pino                | Structured JSON; low-overhead; production-ready    |
| Tests            | Vitest              | Fast; works with Bun; compatible with the frontend test config |

---

## 3. Directory structure

```
backend/
├── src/
│   ├── config/         — Zod-validated environment configuration
│   ├── db/
│   │   ├── client.ts   — Drizzle singleton, health check, close
│   │   ├── migrate.ts  — Migration runner (bun run db:migrate)
│   │   └── schema/     — Drizzle table definitions (source of truth for types)
│   ├── errors/         — AppError hierarchy; toBody() → contract error shape
│   ├── lib/
│   │   ├── logger.ts   — Pino factory; secrets redacted
│   │   ├── cache.ts    — CacheDriver interface + MemoryCacheDriver
│   │   ├── storage.ts  — StorageDriver interface + LocalStorageDriver
│   │   └── email.ts    — EmailDriver interface + ConsoleEmailDriver
│   ├── middleware/
│   │   ├── request-id.ts  — Reads/generates x-request-id; echoes in response
│   │   ├── logger.ts      — HTTP request/response logging
│   │   ├── auth.ts        — requireAuth / optionalAuth / requireRole
│   │   ├── rate-limit.ts  — RateLimitStore interface + MemoryRateLimitStore
│   │   └── security.ts    — Defence-in-depth response headers
│   ├── routes/
│   │   └── health.ts   — GET /health (liveness) + GET /ready (readiness)
│   ├── app.ts          — createApp() factory (used by server and tests)
│   └── main.ts         — Entry point; config validation; graceful shutdown
├── migrations/
│   └── 0000_initial_schema.sql — users + sessions tables
├── tests/              — Vitest tests (no real DB required)
├── drizzle.config.ts   — Drizzle-kit migration generator config
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

---

## 4. Configuration

All environment variables are validated at startup via Zod (`src/config/index.ts`).
The process exits with a clear error message if any required variable is missing
or invalid. See `.env.example` for the full list.

Required variables:
- `JWT_SECRET` — minimum 32 characters, no default

Optional variables with defaults:
- `PORT` (3000), `HOST` (0.0.0.0), `NODE_ENV` (development)
- `CORS_ORIGIN` (http://localhost:5000)
- `RATE_LIMIT_WINDOW_MS` (60 000), `RATE_LIMIT_MAX` (100)
- `EMAIL_DRIVER` (console), `STORAGE_DRIVER` (local)
- `JWT_EXPIRES_IN` (24h)

---

## 5. API versioning

Routes will be mounted under `/v1/` as domain features are added.
The health/readiness endpoints are unversioned (they are infrastructure
endpoints, not API endpoints).

---

## 6. Error handling

All errors must be instances of `AppError` (or a subclass). The Hono
`onError` handler in `createApp()` converts them to the contract shape:

```json
{ "status": 400, "code": "validation_error", "message": "...", "details": {...} }
```

Unexpected errors (`new Error(...)`) are caught and mapped to `500
internal_error` with a generic message — the real error is logged but
never exposed to the client.

---

## 7. Authentication foundation

JWT tokens are validated via `requireAuth` middleware (jose, no native deps).
Tokens carry `{ userId, role }` in the payload. The middleware sets
`c.var.auth` for downstream handlers.

**TODO (Stage 2):**
- `POST /v1/auth/register` — hash password (argon2 or bcrypt), create user + session
- `POST /v1/auth/login` — verify password, issue JWT
- `POST /v1/auth/logout` — revoke session
- `POST /v1/auth/recover` — send password reset email
- `GET  /v1/auth/me` — return current user from token

---

## 8. Database

Drizzle ORM with PostgreSQL via postgres-js. Schema in `src/db/schema/`.
Migrations are plain SQL files in `migrations/` tracked by Drizzle's
`__drizzle_migrations` table.

Run migrations: `bun run db:migrate`
Generate new migration: `bun run db:generate`

Stage 1 schema:
- `users` — id (ULID), email, password_hash, role, display_name, soft-delete
- `sessions` — id, user_id (FK), token, refresh_token, expires_at, revoked

Connection pooling is configured in `src/db/client.ts` (max 10 connections,
30 s idle timeout). `closeDb()` is called during graceful shutdown.

---

## 9. Infrastructure abstractions

All replaceable service boundaries:

| Abstraction         | Interface         | Stage 1 impl         | Production replacement      |
|---------------------|-------------------|----------------------|-----------------------------|
| Cache               | `CacheDriver`     | `MemoryCacheDriver`  | Redis / Valkey / DragonflyDB |
| Storage             | `StorageDriver`   | `LocalStorageDriver` | S3 / R2 / GCS               |
| Email               | `EmailDriver`     | `ConsoleEmailDriver` | SMTP / SendGrid / Resend    |
| Rate-limit store    | `RateLimitStore`  | `MemoryRateLimitStore` | Redis sliding-window       |

Business logic imports the interface only; driver selection happens in the
app factory / DI root.

---

## 10. Security baseline

Implemented in Stage 1:
- Request ID on every request and response (`x-request-id`)
- CORS with explicit allow-list (`CORS_ORIGIN`)
- Security response headers (x-content-type-options, x-frame-options, referrer-policy, permissions-policy, HSTS in production)
- Rate limiting with `RateLimitStore` abstraction
- JWT middleware (`requireAuth`, `optionalAuth`, `requireRole`)
- Safe error responses (no stack traces or internal identifiers in 5xx body)
- Secrets redacted from all log output (pino `redact` config)

**TODO (Stage 2):**
- Argon2 / bcrypt for password hashing
- CSRF protection (if cookie-based sessions are used)
- Input sanitization (Zod handles type coercion; XSS sanitization needed for user-generated HTML)
- Audit log for sensitive operations

---

## 11. Logging

Structured JSON via pino. Every log line includes:
- `timestamp` (ISO-8601)
- `requestId` (from request-id middleware)
- `method`, `path`, `status`, `durationMs` (HTTP logs)
- `level` (info / warn / error / debug)

The following fields are **always** redacted (replaced with `[REDACTED]`):
- `authorization` request header
- Any field named `password`, `newPassword`, `currentPassword`, `token`, `refreshToken`, `secret`, `apiKey`, `api_key`

---

## 12. Health and readiness

`GET /health` — liveness.
Returns `{ status: "ok", timestamp, version, environment }`.
Does not check external dependencies.
Use for load-balancer and k8s liveness probes.

`GET /ready` — readiness.
Checks database reachability.
Returns `{ status: "ready" | "not_ready", checks: { database: ... }, timestamp }`.
Returns 503 if any dependency is in `"error"` state.
Use for k8s readiness probes.

---

## 13. Graceful shutdown

Implemented in `src/main.ts`:
1. `SIGTERM` / `SIGINT` received
2. `server.stop(false)` — stop accepting new requests; drain in-flight
3. `closeDb()` — close postgres-js connection pool (5 s timeout)
4. TODO: close cache, storage, email connections when real drivers are added
5. `process.exit(0)`

---

## 14. Portability

The backend has **zero Replit-specific dependencies**. It can run on:

| Target                | How                                    |
|-----------------------|----------------------------------------|
| Local machine (Bun)  | `cd backend && bun run dev`            |
| Docker               | `docker compose up`                    |
| External PostgreSQL  | Set `DATABASE_URL`                     |
| External Redis cache | Set `REDIS_URL` (TODO: implement driver) |
| External S3 storage  | Set `STORAGE_DRIVER=s3` + S3 vars      |
| Cloud VM             | `bun run src/main.ts`                  |
| Container platform   | Use `Dockerfile` (multi-stage, non-root) |
| Node.js runtime      | Change server adapter in `main.ts`; Hono supports Node |

---

## 15. Known limitations (Stage 1)

- No auth endpoints implemented yet (middleware only).
- No domain API endpoints (providers, search, messaging, etc.).
- `MemoryCacheDriver` and `MemoryRateLimitStore` do not coordinate across
  instances — not suitable for multi-instance production.
- `LocalStorageDriver` writes to the local filesystem — not suitable for
  multi-instance or ephemeral environments.
- `ConsoleEmailDriver` does not send real email.
- SMTP, S3, and Redis drivers are stubbed (throw on use).
- `GET /auth/me` not implemented (see contract drift in `src/api/contracts.md`).
- Refresh token flow not implemented.

---

## 16. Development

```bash
# Install backend dependencies
cd backend && bun install

# Start backend dev server (hot-reload)
bun run dev

# Run tests
bun run test

# Type check
bun run typecheck

# Generate a migration after schema changes
bun run db:generate

# Apply migrations
bun run db:migrate

# Start local PostgreSQL (requires Docker)
cd .. && docker compose up postgres
```

The frontend and backend run on separate ports:
- Frontend: http://localhost:5000 (TanStack Start / Vite)
- Backend:  http://localhost:3000 (Hono / Bun)

Set `VITE_API_BASE_URL=http://localhost:3000` in the frontend to route API
calls to the real backend instead of the mock adapter.
