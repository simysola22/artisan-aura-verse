# Frontend Handoff

Status: **frontend complete, backend not started**. This document is the
single entry point for anyone picking up the project for backend or
infrastructure work.

Companion documents:
- `src/api/contracts.md` — the API contract (source of truth for endpoints).
- `src/routes/README.md` — routing conventions.

---

## 1. Architecture

Feature-based, transport-agnostic, mock-backed. Layer boundaries are
enforced by directory:

```
UI primitives          →  src/components/ (ui/, glass/, common/)
Feature modules        →  src/features/   (auth, theme, providers)
Layouts (shells)       →  src/layouts/    (PublicShell, OpsShell, AuthShell)
Routes (pages)         →  src/routes/     (file-based, TanStack Router)
Domain API             →  src/api/*.ts    (per-domain façade)
Mock adapter           →  src/api/mock/   (only src/api/* may import this)
Domain types           →  src/types/      (single source of truth)
```

Rules already enforced:
- Feature components import from `src/api` only (never from `src/api/mock`).
  Verified: `rg "from ['\"].*api/mock" src --glob '!src/api/**'` returns none.
- No component reads mock data directly.
- Every domain API file has a `USE_MOCK_API` branch and an `apiFetch(...)`
  branch — swap-in requires editing one file per domain.

---

## 2. Application structure

### Routes (file-based, `src/routes/`)

| Path | File | Shell | Notes |
|------|------|-------|-------|
| `/` | `index.tsx` | Public | Landing |
| `/for-employers` | `for-employers.tsx` | Public | |
| `/for-providers` | `for-providers.tsx` | Public | |
| `/how-it-works` | `how-it-works.tsx` | Public | |
| `/auth/login` | `auth.login.tsx` | Auth | |
| `/auth/register` | `auth.register.tsx` | Auth | Role toggle: employer/provider |
| `/auth/recover` | `auth.recover.tsx` | Auth | |
| `/dashboard` | `dashboard.tsx` | Public | Post-login home |
| `/search` | `search.tsx` | Public | Filters + result grid |
| `/providers/$providerId` | `providers.$providerId.tsx` | Public | |
| `/messages` | `messages.tsx` | Public | Inbox |
| `/messages/$conversationId` | `messages.$conversationId.tsx` | Public | Thread |
| `/verification` | `verification.tsx` | Public | Multi-step form |
| `/account` | `account.tsx` | Public | |
| `/ops` | `ops.index.tsx` | Ops | Internal, `noindex` |
| `/ops/verification` | `ops.verification.tsx` | Ops | |
| `/ops/moderation` | `ops.moderation.tsx` | Ops | |
| `/ops/support` | `ops.support.tsx` | Ops | |
| `/ops/users` | `ops.users.tsx` | Ops | |
| `/sitemap.xml` | `sitemap[.]xml.ts` | — | Server route |

### Major modules

- **`src/features/auth`** — `AuthProvider`, `useAuth`. Frontend session
  abstraction.
- **`src/features/theme`** — `ThemeProvider`, `useTheme`, `ThemeToggle`.
  Three themes via `data-theme` attribute.
- **`src/features/providers`** — `ProviderCard` presentation component.
- **`src/components/glass`** — glass surface primitives.
- **`src/components/common/data-state`** — `LoadingState`, `EmptyState`,
  `ErrorState`, `DataStateBoundary` for uniform loading/empty/error UX.

---

## 3. Backend contract

See `src/api/contracts.md` for endpoint-by-endpoint detail. Highlights:

- Every domain lives in `src/api/<domain>.ts`; each function has a mock
  branch and a real branch. Backend wiring means deleting the mock branch,
  not editing components.
- `ApiError` (`src/api/client.ts`) is the single error type. Backend errors
  MUST match the shape in the contract doc.
- Pagination: 1-based `page` + `pageSize`, response `Paginated<T>`. Two
  endpoints still return bare arrays for mock compatibility (providers,
  conversations) — listed under "Contract drift" in the contract doc.
- Ranking is backend-owned. `/search/providers` returns results in display
  order; the frontend does not compute or override scores.

---

## 4. Authentication

### Current implementation (mock)

`src/features/auth/auth-context.tsx`:
- `login/register/logout/recover` proxy to `authApi.*`.
- Session token + user object cached in `localStorage`
  (`mp.session.token`, `mp.session.user`).
- `AuthProvider` hydrates from storage on mount to survive refresh in the
  demo.

### Replacement points (when real auth is wired)

Update these locations only:

1. `src/api/auth.ts` — remove `USE_MOCK_API` branches; the endpoints stay
   the same.
2. `src/features/auth/auth-context.tsx`
   - Replace the `localStorage`-based hydrate with a boot call to
     `GET /auth/me`.
   - Do NOT trust the cached `User` for anything except optimistic UI. The
     server response from `/auth/me` is authoritative.
   - Add refresh-token handling if the chosen provider uses one.
3. `src/api/client.ts` — `getAuthToken()` currently reads
   `localStorage.mp.session.token`. If the real auth provider uses HTTP-only
   cookies, switch to `credentials: "include"` and drop the manual header.
4. Any component using `useAuth()` — no change needed; the interface is
   stable.

### Security invariants (do not break)

- **The frontend performs zero authorization.** Route-level hiding of Ops
  or role-gated UI is UX only.
- No secret, API key, service token, or private credential is stored in the
  repo. `rg -ni "api[_-]?key|secret"` returns only field-name references
  (form labels, request body keys) — no committed values.
- `localStorage` is used for: theme preference, demo session token, demo
  cached user. No PII beyond the display email is stored. When real auth
  ships, prefer HTTP-only cookies for the session token.
- Passwords are transmitted in the login/register request body only; they
  are never logged, cached, or persisted client-side.

---

## 5. Operations application

### Current

```
Public app (this repo)
    └── /ops/* routes (same bundle, Ops shell)
```

Ops routes render `<meta name="robots" content="noindex">` and use a
different shell for visual separation.

### Future (required before real ops data flows)

```
Public application               Separate operations application
    └── Public users                 └── Owner
                                     └── Administrators
                                     └── Verification staff
                                     └── Support staff
                                     └── Moderation staff
                                     └── Operations engineers
```

The `/ops/*` routes in this repo are a **placeholder UI**, not a security
boundary. Route separation alone does not protect anything. The backend MUST
enforce every ops-only permission at the API layer. When the separate ops
app is stood up, the `src/routes/ops.*` files can be lifted into it largely
as-is; the shell and API layer are already isolated.

---

## 6. Messaging

### Frontend abstraction

`src/api/messaging.ts` exposes:
- `listConversations()`, `listMessages(id)`, `sendMessage(id, body)` — HTTP.
- `subscribe(conversationId, onMessage) => unsubscribe` — transport
  abstract.

### Realtime transport — backend decides

The frontend does **not** couple to WebSockets, SSE, or polling. Any of the
three satisfies the contract as long as new messages reach the callback and
the returned function tears the subscription down. Reconnection is
transport-owned; the frontend refetches via React Query invalidation on
reconnect.

### Error handling

- Send failures: `useMutation` surfaces the error; UI shows via
  `DataStateBoundary`.
- Load failures: `useQuery` error state, retry via `refetch()`.
- Subscription errors: log + rely on next reconnect. The frontend does not
  attempt to reconstruct history in-memory.

---

## 7. Verification

Current UI: multi-step form (`/verification`) with status pill
(`unverified` / `in_review` / `additional_info_requested` / `verified` /
`rejected`) and an "info requested" banner.

Automation compatibility: the same status enum and badge are used whether a
human or an automated pipeline made the decision. Adding an automated stage
requires no UI change beyond adding a status value in `src/types` and
`contracts.md` together.

Resubmission: `POST /verification/:providerId` accepts a partial payload;
status transitions back to `in_review`.

File uploads: currently UI-only (files selected but not sent). A storage
endpoint decision (S3 presigned URL vs. multipart) is a backend
prerequisite before verification can go live end-to-end.

---

## 8. Search

- Frontend owns: input, filter state, request assembly, result rendering,
  pagination controls.
- Backend owns: ranking, scoring, matching logic, any future AI-assisted
  matching.
- The frontend renders results in the order returned. It does not sort
  server results by score client-side.
- Introducing AI matching later requires no UI change — the frontend
  already treats the result list as opaque-ranked.

---

## 9. Environment variables

### Frontend (public — safe to expose to the browser)

| Name | Default | Purpose |
|------|---------|---------|
| `VITE_API_BASE_URL` | `""` (empty → mock mode) | Base URL for the real backend. When empty, `USE_MOCK_API` is true. |
| `VITE_USE_MOCK_API` | `"false"` | Force mock mode even when a base URL is set. Useful for local dev against production URLs. |

Both are read once in `src/api/client.ts` and gate all real vs. mock
routing. Any `VITE_*` variable is bundled into the client — never place a
private value in one.

### Backend / infrastructure (private — never exposed to the frontend)

Not consumed by this repo. Listed here so the boundary is explicit:

- Database credentials
- JWT signing secret / auth provider secrets
- SMTP / transactional email keys
- File storage credentials
- Realtime transport credentials
- Any third-party API secret

The frontend must never receive any of the above.

---

## 10. Known limitations (must be addressed by backend / infra stages)

- **No real authentication.** `AuthProvider` uses `localStorage` for demo
  continuity only. Not secure.
- **No authorization.** Any role-based UI hiding is UX. Backend must gate
  every endpoint.
- **Realtime messaging is a no-op** in mock (`subscribe` returns an empty
  teardown function).
- **Verification file uploads are UI-only** — no storage endpoint.
- **Pagination is stubbed** on providers and conversations endpoints
  (returns bare arrays). Backend must ship pagination and the frontend
  adapter must be updated in the same change.
- **Ops routes are not secured** — they share the bundle and the auth
  surface with the public app. Move to a separate deployment before ops
  data flows.
- **No `/auth/me` boot check** — frontend trusts cached user until real auth
  is wired.
- **No refresh-token flow** modeled.
- **Mock user id `"me"`** is used as a fallback when no session exists so
  the demo works. Real auth removes the fallback (`user?.id` becomes the
  only source).

---

## 11. Backend / infrastructure to-do (recommended order)

1. Stand up the backend that implements `src/api/contracts.md` exactly.
2. Set `VITE_API_BASE_URL` in the deploy environment.
3. Delete `USE_MOCK_API` branches from every file in `src/api/*.ts` (leave
   `src/api/mock/` — the demo & tests still use it).
4. Wire real auth into `src/features/auth/auth-context.tsx` per §4.
5. Pick a messaging transport and implement `messagingApi.subscribe`.
6. Add the verification file-upload endpoint and wire it into
   `src/routes/verification.tsx`.
7. Ship pagination on providers/conversations; update the two adapters.
8. Stand up the separate ops application; move `src/routes/ops.*` into it.
9. Enforce authorization on every endpoint. Re-run the security audit.

---

## 12. Local dev

```bash
bun install
bun dev
```

Runs against the mock adapter by default. To hit a real backend during
development:

```bash
VITE_API_BASE_URL=https://api.example.com bun dev
# or, to force mock even with a base URL set:
VITE_USE_MOCK_API=true bun dev
```
