# PMP Backend Architecture

Status: **Stage 2 — Clerk authentication + RBAC complete.**

This document describes the backend architecture as actually implemented.
Future capabilities that are only planned are labeled **TODO (Stage N)**.

---

## 1. Overview

The backend is a standalone HTTP API server that implements the contract
defined in `src/api/contracts.md`. Authentication is delegated entirely to
Clerk. The backend verifies Clerk session tokens, resolves the Clerk identity
to a PMP user in PostgreSQL, loads roles and permissions from the DB, and
enforces authorization server-side.

```
Frontend (TanStack Start — Vercel)
    ↓  HTTPS  Authorization: Bearer <clerk_session_token>
Backend API (Hono, Bun — Render)
    ↓
Clerk token verification (@clerk/backend)
    ↓
PMP user resolution (PostgreSQL — Railway)
    ↓
Role + permission loading
    ↓
Route handler + authorization guards
```

---

## 2. Technology stack

| Concern          | Choice                | Rationale                                          |
|------------------|-----------------------|----------------------------------------------------|
| Runtime          | Bun                   | Consistent with the frontend; TypeScript-native    |
| HTTP framework   | Hono v4               | Portable across Bun/Node/Cloudflare; minimal       |
| ORM              | Drizzle ORM           | Type-safe, version-controlled migrations           |
| Database         | PostgreSQL 16         | Railway-hosted in production                       |
| DB driver        | postgres-js           | Lightweight; works with Bun and Node               |
| Validation       | Zod                   | Consistent with frontend schemas                   |
| Auth provider    | Clerk                 | Owns registration, login, sessions, password mgmt  |
| Auth verification| @clerk/backend        | verifyToken() — server-side Clerk JWT verification |
| Logging          | pino                  | Structured JSON; secrets redacted                  |
| Tests            | Vitest                | Fast; mock-injection pattern for Clerk and DB      |

---

## 3. Production deployment targets

| Service          | Platform         | Notes                                              |
|------------------|------------------|----------------------------------------------------|
| Frontend         | Vercel           | TanStack Start + React; uses Clerk frontend SDK    |
| Backend API      | Render           | Bun runtime; `bun run src/main.ts`                 |
| Database         | Railway          | PostgreSQL 16; connect via `DATABASE_URL`          |
| Authentication   | Clerk            | Session tokens issued to frontend, verified by API |

The backend has **zero Replit-specific dependencies**. Replit is used only as the development environment.

---

## 4. Directory structure

```
backend/
├── src/
│   ├── config/         — Zod-validated environment configuration
│   ├── db/
│   │   ├── client.ts   — Drizzle singleton, health check, close
│   │   ├── migrate.ts  — Migration runner (bun run db:migrate)
│   │   └── schema/
│   │       ├── users.ts   — users table (Clerk-centric identity)
│   │       └── roles.ts   — roles, permissions, role_permissions, user_roles
│   ├── errors/         — AppError hierarchy; toBody() → contract error shape
│   ├── lib/
│   │   ├── clerk.ts    — ClerkAuthAdapter interface + real/mock factories
│   │   ├── logger.ts   — Pino factory; secrets redacted
│   │   ├── cache.ts    — CacheDriver interface + MemoryCacheDriver
│   │   ├── storage.ts  — StorageDriver interface + LocalStorageDriver
│   │   └── email.ts    — EmailDriver interface + ConsoleEmailDriver
│   ├── middleware/
│   │   ├── auth.ts        — requireClerkAuth / optionalClerkAuth / requirePermission
│   │   ├── request-id.ts  — x-request-id propagation
│   │   ├── logger.ts      — HTTP request/response logging
│   │   ├── rate-limit.ts  — RateLimitStore interface + MemoryRateLimitStore
│   │   └── security.ts    — Defence-in-depth response headers
│   ├── routes/
│   │   ├── health.ts   — GET /health (liveness) + GET /ready (readiness)
│   │   └── auth.ts     — GET /v1/auth/me + POST /v1/auth/sync
│   ├── services/
│   │   └── identity.ts — resolveIdentity(), provisionUser(), serializeIdentity()
│   ├── app.ts          — createApp() factory (used by server and tests)
│   └── main.ts         — Entry point; config validation; graceful shutdown
├── migrations/
│   ├── 0000_initial_schema.sql — Stage 1 foundation (users + sessions)
│   └── 0001_clerk_identity.sql — Stage 2 (Clerk identity + RBAC)
├── tests/              — Vitest tests (no real DB or Clerk required)
├── drizzle.config.ts   — Drizzle-kit migration generator config
├── tsconfig.json       — Strict TypeScript config
└── package.json        — Backend-only dependencies
```

---

## 5. Authentication architecture

### Clerk owns

- User registration and email verification.
- Login, password management, password recovery.
- Session lifecycle (issuance, expiry, revocation).
- Multi-factor authentication.
- The session token (a JWT signed by Clerk's private key).

### The PMP backend owns

- Server-side verification of the Clerk session token.
- Mapping Clerk user ID → PMP user record in PostgreSQL.
- Role assignment and permission resolution.
- All authorization decisions.

### Per-request flow

```
1. Client sends: Authorization: Bearer <clerk_session_token>
2. requireClerkAuth middleware extracts the token.
3. ClerkAuthAdapter.verifyToken(token) calls @clerk/backend verifyToken().
   - On failure: 401 Unauthorized (invalid/expired token)
4. The verified ClerkVerifyResult.clerkUserId is extracted.
5. identityService.resolveIdentity(db, clerkUserId) queries PostgreSQL:
   - Loads users row WHERE clerk_user_id = ?
   - If not found: 401 (account not provisioned — call /v1/auth/sync first)
   - If status = 'suspended': 403 Forbidden
   - If status = 'deleted': 401
   - Loads user_roles JOIN roles for this user.
   - Loads role_permissions JOIN permissions for those roles.
6. AuthContext is attached: c.var.auth = { clerkUserId, pmpUserId, accountType, roleNames, permissions }
7. Route handler runs. Authorization guards (requirePermission, etc.) check c.var.auth.permissions.
```

### ClerkAuthAdapter interface

The rest of the application depends only on `ClerkAuthAdapter`, not on `@clerk/backend` directly:

```ts
interface ClerkAuthAdapter {
  verifyToken(token: string): Promise<ClerkVerifyResult>;
}
```

- **Real adapter** (`createClerkAdapter(secretKey)`): calls `@clerk/backend.verifyToken()`.
- **Mock adapter** (`createMockClerkAdapter(map)`): deterministic; used in tests.

Tests never call Clerk's live service.

---

## 6. Database model

### `users` table

| Column         | Type           | Notes                                           |
|----------------|----------------|-------------------------------------------------|
| id             | TEXT PK        | UUID generated by application                   |
| clerk_user_id  | TEXT UNIQUE NN | External Clerk identity reference (indexed)     |
| account_type   | account_type   | See §7 — source of authorization                |
| provider_kind  | provider_kind  | 'artisan' or 'professional' — provider only     |
| status         | user_status    | 'active', 'suspended', or 'deleted'             |
| display_name   | TEXT nullable  | Cached from Clerk; Clerk is source of truth     |
| email          | TEXT nullable  | Cached from Clerk; Clerk is source of truth     |
| avatar_url     | TEXT nullable  | Cached from Clerk; Clerk is source of truth     |
| created_at     | TIMESTAMPTZ    |                                                 |
| updated_at     | TIMESTAMPTZ    |                                                 |

**Do not store passwords in PostgreSQL. Clerk owns credentials.**

### `roles` table

Seeded by migration. Named roles: `employer`, `provider`, `owner`, `system_admin`,
`verification_team`, `support_team`, `moderation_team`.

### `permissions` table

Seeded by migration. Atomic permission strings (e.g. `"verification.review"`).
New permissions are added via migration — no schema change required.

### `role_permissions` table

Join table mapping which permissions belong to each role. Seeded by migration.

### `user_roles` table

Join table mapping which roles a user holds. Populated by `provisionUser()` and
by internal admin operations. Never populated by the public sync endpoint with
internal roles.

---

## 7. Account types

### Public (self-registerable)

| Type       | Default role | Description                            |
|------------|--------------|----------------------------------------|
| `employer` | employer     | Posts jobs and searches for providers  |
| `provider` | provider     | Artisans and professionals             |

Providers may also set `provider_kind = 'artisan' | 'professional'`.

### Internal (provisioned through controlled backend process only)

| Type                | Default role        | Description                      |
|---------------------|---------------------|----------------------------------|
| `owner`             | owner               | Full system access               |
| `system_admin`      | system_admin        | System administration            |
| `verification_team` | verification_team   | Reviews verification applications|
| `support_team`      | support_team        | Customer support                 |
| `moderation_team`   | moderation_team     | Content moderation               |

**Internal account types are never assignable via `POST /v1/auth/sync`.**
The `provisionUser()` function throws `ForbiddenError` for any non-public type.
The route's Zod schema (`z.enum(["employer", "provider"])`) adds a second layer
of enforcement — internal types cannot even pass validation.

---

## 8. Permission system

Permissions are fine-grained strings checked via `auth.permissions.has("name")`.

| Permission                | Who has it                              |
|---------------------------|-----------------------------------------|
| profile.read              | employer, provider                      |
| profile.update            | employer, provider                      |
| providers.search          | employer                                |
| providers.view            | employer                                |
| messaging.use             | employer, provider                      |
| verification.submit       | provider                                |
| verification.read         | verification_team                       |
| verification.review       | verification_team                       |
| verification.request_info | verification_team                       |
| verification.approve      | verification_team                       |
| verification.reject       | verification_team                       |
| verification.manage       | system_admin                            |
| support.read              | support_team                            |
| support.respond           | support_team                            |
| support.manage            | support_team, system_admin              |
| moderation.read           | moderation_team                         |
| moderation.review         | moderation_team                         |
| moderation.action         | moderation_team                         |
| moderation.manage         | system_admin                            |
| users.read                | system_admin                            |
| users.manage              | system_admin                            |
| system.manage             | system_admin                            |
| (all permissions)         | owner                                   |

### Authorization guards

```ts
requirePermission("verification.review")       // needs exactly this permission
requireAnyPermission("verification.read", "verification.manage")  // needs one of
requireAccountType("employer", "provider")     // needs this account type
```

All guards throw `ForbiddenError` (403) on failure. `requireClerkAuth` must run first.

---

## 9. API endpoints (Stage 2)

### `GET /v1/auth/me`

- Auth: Bearer required.
- Returns the authenticated PMP user + roles + permissions.
- Frontend should call this on boot rather than trusting cached localStorage user.
- Returns 401 if no PMP account exists for the Clerk identity (sync required).

### `POST /v1/auth/sync`

- Auth: Bearer required.
- Body: `{ accountType: "employer" | "provider", providerKind?: "artisan" | "professional", displayName?: string }`
- Creates the PMP user record on first call (201). Idempotent on subsequent calls (200).
- Only `employer` and `provider` account types are accepted — internal types return 400 or 403.

### Clerk-handled endpoints (not implemented in backend)

The following flows from `src/api/contracts.md` are handled entirely by Clerk on the frontend:

- `POST /auth/register` → Clerk's `signUp()` frontend method.
- `POST /auth/login` → Clerk's `signIn()` frontend method.
- `POST /auth/logout` → Clerk's `signOut()` frontend method.
- `POST /auth/recover` → Clerk's password reset flow.

After Clerk registration, the frontend calls `POST /v1/auth/sync` to create the PMP record.

---

## 10. User provisioning flow

```
User clicks "Register" on the frontend
    ↓
Clerk handles registration (email verification, etc.)
    ↓
Clerk issues a session token
    ↓
Frontend calls POST /v1/auth/sync with { accountType, displayName, providerKind? }
    ↓
Backend verifies the Clerk token
    ↓
Backend creates the PMP user record + assigns the default role
    ↓
Frontend calls GET /v1/auth/me on boot for all subsequent requests
    ↓
Backend returns { user, roles, permissions } from PostgreSQL
```

---

## 11. Environment variables

### Backend-only (never VITE_ prefix, never expose to frontend)

| Variable          | Required | Notes                                           |
|-------------------|----------|-------------------------------------------------|
| `DATABASE_URL`    | Yes      | Railway PostgreSQL connection string            |
| `CLERK_SECRET_KEY`| Yes      | Clerk server secret; never commit or log        |
| `CORS_ORIGIN`     | No       | Default: `http://localhost:5000`                |
| `NODE_ENV`        | No       | Default: `development`                          |
| `PORT`            | No       | Default: `3000`                                 |
| `HOST`            | No       | Default: `0.0.0.0`                              |

### Removed in Stage 2

| Variable          | Reason removed                                              |
|-------------------|-------------------------------------------------------------|
| `JWT_SECRET`      | Clerk owns token signing. Custom JWT signing removed.       |
| `SESSION_SECRET`  | Never used. Clerk owns session lifecycle.                   |

### Frontend-only (VITE_ prefix, safe to bundle in browser)

| Variable                    | Notes                                     |
|-----------------------------|-------------------------------------------|
| `VITE_CLERK_PUBLISHABLE_KEY`| Public Clerk key for frontend SDK         |
| `VITE_API_BASE_URL`         | Backend API URL (empty = full mock mode)  |

---

## 12. Local development setup

```bash
# 1. Start a local PostgreSQL instance
docker-compose up -d postgres

# 2. Copy and fill in the environment file
cp .env.example backend/.env
# Edit backend/.env — set DATABASE_URL, CLERK_SECRET_KEY

# 3. Run migrations
cd backend && bun run db:migrate

# 4. Start the backend (hot-reload)
bun run dev

# 5. Start the frontend (separate terminal)
cd .. && bun run dev
```

---

## 13. Production deployment (Render + Railway)

### Railway PostgreSQL

1. Create a Railway project and add a PostgreSQL service.
2. Copy the connection string → `DATABASE_URL` on Render.
3. Run `bun run db:migrate` once after each deployment via Render's deploy hooks or a one-off Railway job.

### Render backend

1. Create a new Render Web Service.
2. Build command: (none — Bun runs TypeScript directly)
3. Start command: `cd backend && bun run src/main.ts`
4. Set environment variables: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CORS_ORIGIN` (Vercel frontend URL), `NODE_ENV=production`.
5. Health check path: `/health`.

### Vercel frontend

1. Deploy as a Vercel project.
2. Set: `VITE_API_BASE_URL` (Render backend URL), `VITE_CLERK_PUBLISHABLE_KEY`.
3. In Clerk dashboard: add the Vercel domain to allowed origins.

---

## 14. What Replit provides (and what it does not)

### Replit provides

- Development environment (editor, terminal, preview URL).
- Secure secret storage for `CLERK_SECRET_KEY`, `DATABASE_URL`, etc.
- A running `bun run dev` workflow for the frontend preview.

### Replit does NOT provide

- The production database (Railway PostgreSQL).
- The production auth service (Clerk).
- The production backend host (Render).
- Any Replit-specific dependency that would break deployment outside Replit.

The backend codebase contains **zero `@replit` imports**, zero `REPLIT_*` env vars,
and zero Replit-specific API calls.

---

## 15. Security boundaries

| Boundary                        | Enforcement                                    |
|---------------------------------|------------------------------------------------|
| Identity source                 | Always the verified Clerk token — never client body |
| Permission source               | Always PostgreSQL — never client headers/body  |
| Internal role assignment        | Never via public API; provisionUser() enforces |
| Token verification              | Server-side via @clerk/backend — never frontend |
| Secrets in logs                 | Pino redacts password/token/secret/auth fields |
| Secrets in responses            | Error handler never leaks internal details     |
| SQL injection                   | Drizzle ORM with parameterized queries only    |
| Security headers                | securityHeaders middleware on all responses    |
| Rate limiting                   | In-memory (dev); Redis interface ready         |

---

## 16. Known limitations

1. **In-memory rate limiting** does not coordinate across multiple instances.
   Redis interface (`RateLimitStore`) is in place for replacement.
2. **Cache, storage, and email abstractions** are wired to dev/console drivers
   only. Real drivers (Redis, S3, SMTP) are not yet implemented.
3. **`GET /auth/me` profile caching** accepts optional query params from the
   frontend but has no webhook-driven cache invalidation when Clerk profile
   changes. A Clerk webhook handler (Stage N) will push updates.
4. **No internal user provisioning endpoint** yet. Internal accounts must be
   inserted directly into the database by an administrator.

---

## 17. Stage 3 recommendations

1. Implement Clerk webhook handler to receive `user.updated` events and keep
   `display_name`, `email`, `avatar_url` in sync automatically.
2. Implement provider/employer profile endpoints (`GET/PUT /v1/providers/:id`,
   `GET/PUT /v1/employers/:id`).
3. Implement search endpoint (`GET /v1/search/providers`).
4. Add Redis-backed rate limiting for multi-instance safety.
5. Add an internal user provisioning endpoint (protected by `system.manage`
   permission) for onboarding staff accounts.
