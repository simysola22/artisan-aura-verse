# API Contracts (frontend-assumed)

This document tracks the endpoint shapes the frontend currently assumes. The
frontend routes all data through `src/api/*` which today calls an in-memory
mock adapter. When the backend is implemented, replace each mock call with
`apiFetch(...)` and keep this document in sync with the real contract.

All endpoints are JSON, use ISO-8601 date strings, and require
`Authorization: Bearer <token>` unless noted `Public`.

## Auth (`src/api/auth.ts`)

- `POST /auth/register` — Public
  - Body: `{ email, password, role: "employer" | "provider", displayName }`
  - 200: `{ session: AuthSession, user: User }`
- `POST /auth/login` — Public
  - Body: `{ email, password }`
  - 200: `{ session: AuthSession, user: User }`
  - 401: invalid credentials
- `POST /auth/logout` — 204
- `POST /auth/recover` — Public. Body: `{ email }`. 200: `{ ok: true }`

## Providers (`src/api/providers.ts`, `src/api/search.ts`)

- `GET /providers` — 200: `Provider[]`
- `GET /providers/:id` — 200: `Provider`. 404 when missing.
- `GET /search/providers?q=&category=&skill=&kind=&verified=&location=&sort=`
  - 200: `SearchResult` (paginated). Ranking is backend-owned.

## Verification (`src/api/verification.ts`)

- `GET /verification/:providerId` — 200: `VerificationApplication`
- `POST /verification/:providerId` — Body: `Partial<VerificationApplication>`
  - 200: updated `VerificationApplication` (status typically `in_review`)

## Messaging (`src/api/messaging.ts`)

- `GET /messaging/conversations` — 200: `Conversation[]`
- `GET /messaging/conversations/:id/messages` — 200: `Message[]`
- `POST /messaging/conversations/:id/messages` — Body: `{ body }` — 200: `Message`
- Realtime transport is not decided; the frontend depends only on
  `messagingApi.subscribe(conversationId, onMessage)`. Any of websockets,
  SSE or long-poll will satisfy the contract.

## Reference (`src/api/reference.ts`)

- `GET /reference/categories` — 200: `Category[]`
- `GET /reference/skills` — 200: `Skill[]`

## Placeholders (not yet used)

- `src/api/employers.ts`, `src/api/users.ts`, `src/api/subscriptions.ts` are
  reserved slots. Add endpoints here when their UIs are built.

## Error shape

All errors surfaced through `ApiError`:
```
{ status: number, code?: string, message: string, details?: unknown }
```

## Authorization

The frontend may hide UI based on `user.role` for UX only. Authorization is
backend-owned. Never trust frontend role checks as security.
