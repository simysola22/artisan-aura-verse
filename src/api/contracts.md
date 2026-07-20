# API Contracts (frontend-assumed)

This document is the **source of truth** for the shared frontend/backend
contract. The frontend routes all data through `src/api/*`, which today
delegates to an in-memory mock adapter (`src/api/mock/`). When the backend is
implemented, replace each mock branch with `apiFetch(...)` and keep the
shapes in this document identical to the real implementation.

**Contract rule:** the backend MUST implement this contract as written unless
an approved change is made. Any change requires: (1) update this file,
(2) update the frontend adapter in `src/api/*`, (3) update the backend
implementation, (4) test both sides.

## Conventions

- Transport: JSON over HTTPS.
- Dates: ISO-8601 strings (UTC).
- IDs: opaque strings (UUID or ULID; frontend treats them as `string`).
- Auth: `Authorization: Bearer <token>` on every endpoint unless marked
  **Public**.
- Errors: uniform shape (see [Error shape](#error-shape)).
- Pagination: query params `page` (1-based, default 1) and `pageSize`
  (default 20, max 100). Response wraps items in `Paginated<T>`
  (`{ items, page, pageSize, total }`).
- All permission enforcement is backend-owned. Any frontend role check is
  UX-only and MUST NOT be treated as a security boundary.

---

## Auth — `src/api/auth.ts`

### `POST /auth/register`
- Auth: **Public**
- Body: `{ email: string, password: string, role: "employer" | "provider", displayName: string }`
- 200: `{ session: AuthSession, user: User }`
- 400: validation error (weak password, invalid email)
- 409: email already registered
- Errors: standard error shape

### `POST /auth/login`
- Auth: **Public**
- Body: `{ email: string, password: string }`
- 200: `{ session: AuthSession, user: User }`
- 401: invalid credentials
- 429: rate-limited

### `POST /auth/logout`
- Auth: Bearer required
- 204: success (server should invalidate the token)

### `POST /auth/recover`
- Auth: **Public**
- Body: `{ email: string }`
- 200: `{ ok: true }` — return 200 whether or not the email exists (do not
  leak account existence)

### Future (documented, not yet consumed)
- `POST /auth/reset` — Public. Body: `{ token, newPassword }`.
- `POST /auth/refresh` — Body: `{ refreshToken }` → new `AuthSession`.
- `GET /auth/me` — Bearer. Returns current `User`. Frontend should call this
  on boot rather than trusting a cached `User` (see Auth audit in handoff).

---

## Providers — `src/api/providers.ts`

### `GET /providers`
- Auth: Bearer (may become Public post-launch)
- Query: `page?`, `pageSize?`
- 200: `Paginated<Provider>` (frontend currently accepts a bare `Provider[]`
  for backward compatibility with the mock — see "Contract drift" below)

### `GET /providers/:id`
- Auth: Bearer
- 200: `Provider`
- 404: not found

---

## Search — `src/api/search.ts`

### `GET /search/providers`
- Auth: Bearer (may become Public)
- Query params (all optional):
  - `q: string` — free-text
  - `category: string` — category slug
  - `skill: string` — skill id
  - `kind: "artisan" | "professional"`
  - `verified: boolean`
  - `location: string`
  - `minExperience: number` — years
  - `sort: "relevance" | "rating" | "recent"` — default `"relevance"`
  - `page?`, `pageSize?`
- 200: `SearchResult` (= `Paginated<Provider>`)
- **Ranking is backend-owned.** The frontend renders results in the order
  returned. It MUST NOT compute or override the official score.
- 400: invalid filter values

---

## Verification — `src/api/verification.ts`

### `GET /verification/:providerId`
- Auth: Bearer. Provider may read own; ops staff may read any.
- 200: `VerificationApplication`
- 404: no application exists

### `POST /verification/:providerId`
- Auth: Bearer. Provider on own record only.
- Body: `Partial<VerificationApplication>` (any of `cvUrl`, `evidence`,
  `notes`). File uploads happen via a separate storage endpoint (TBD by
  backend); this endpoint receives URLs, not raw files.
- 200: updated `VerificationApplication` (status typically transitions to
  `in_review`)
- 400: validation error

### Design note — future automation
The `VerificationStatus` enum includes `in_review`,
`additional_info_requested`, `verified`, `rejected`. The frontend renders
the same badge regardless of whether the check was performed by a human or
an automated pipeline. Backend may introduce automated stages without any
frontend change beyond additional status values (add them to
`VerificationStatus` and this contract in the same PR).

---

## Messaging — `src/api/messaging.ts`

### `GET /messaging/conversations`
- Auth: Bearer. Returns only conversations the caller participates in.
- Query: `page?`, `pageSize?`
- 200: `Conversation[]` (may be promoted to `Paginated<Conversation>`)

### `GET /messaging/conversations/:id/messages`
- Auth: Bearer + participant check
- Query: `before?: ISODateString`, `limit?: number` (default 50) — cursor
  pagination for infinite scroll
- 200: `Message[]` (oldest→newest within page)
- 403: not a participant
- 404: conversation not found

### `POST /messaging/conversations/:id/messages`
- Auth: Bearer + participant check
- Body: `{ body: string }` (server assigns id, senderId from token,
  createdAt, status)
- 200: `Message`
- 400: empty body / too long
- 403: not a participant

### Realtime — `messagingApi.subscribe(conversationId, onMessage) => unsubscribe`
- Transport is **not decided**. Contract only requires that new messages
  reach the callback and that the returned function terminates the
  subscription. Any of the following satisfy the contract:
  - WebSocket (`wss://.../messaging?conversationId=…`)
  - Server-Sent Events (`GET /messaging/conversations/:id/stream`)
  - Long-poll fallback
- Reconnection: transport is expected to reconnect automatically with
  exponential backoff. On reconnect, the frontend refetches
  `listMessages(conversationId)` via query invalidation to close any gap.
- Error handling: transport errors are surfaced through the standard
  React Query error path (invalidation on reconnect); the mock is a no-op.

---

## Reference data — `src/api/reference.ts`

### `GET /reference/categories`
- Auth: Public
- 200: `Category[]`
- Cache: safe to CDN-cache (long TTL). Frontend caches via React Query.

### `GET /reference/skills`
- Auth: Public
- 200: `Skill[]`
- Cache: safe to CDN-cache.

---

## Placeholders (not yet consumed)

The following domain files exist as reserved slots. Add endpoints here when
their UIs land; do not silently invent endpoints elsewhere.

- `src/api/employers.ts` — employer-scoped operations (saved providers,
  postings, invitations)
- `src/api/users.ts` — profile edit, avatar upload, account deletion
- `src/api/subscriptions.ts` — plan/entitlement lookups, checkout initiation

---

## Error shape

Every error returned by the backend MUST match:

```json
{
  "status": 400,
  "code": "validation_error",
  "message": "Human-readable summary",
  "details": { "field": "email", "reason": "invalid_format" }
}
```

The frontend surfaces this via `ApiError` (`src/api/client.ts`).

- Never return raw stack traces or internal identifiers in `message`.
- `code` is machine-readable and stable across releases.
- `details` is optional and may be any JSON-serializable value.

---

## Contract drift to resolve before backend implementation

These are known gaps between the current frontend adapter and the intended
backend contract. Reconcile them before wiring the real backend.

1. **Pagination on providers/conversations.** Current mock returns bare
   arrays; contract will require `Paginated<T>`. Frontend adapter must be
   updated at the same time the backend endpoint ships pagination.
2. **File uploads for verification.** No storage endpoint exists yet.
   Backend must decide (S3 presigned URL vs. multipart) and add the endpoint
   here.
3. **`GET /auth/me`.** Frontend currently rehydrates the `User` from
   `localStorage`. This is not authoritative and must be replaced by a boot
   call to `/auth/me` when real auth is wired.
4. **Refresh tokens.** `AuthSession` currently carries only an access token;
   session refresh is not modeled. Decide with backend before launch.
