
# Marketplace Frontend — Build Plan

Scope: frontend only. No backend, no auth provider wiring, no Lovable Cloud. All data flows through a replaceable mock API layer with typed contracts, so a backend team can slot in real endpoints later.

## 1. Design system (`src/styles.css` + tokens)

- Crimson-led palette in `oklch`, with light + dark themes + a "midnight" variant, all driven by CSS variables. Zero hardcoded colors in components.
- Glass token set: `--surface-glass`, `--surface-glass-strong`, `--border-glass`, `--shadow-glass`, `--blur-sm/md/lg`. Standard `backdrop-filter` only (no `-webkit-` duplicates).
- Semantic tokens: background, surface, surface-elevated, text, text-muted, primary (crimson), primary-foreground, success, warning, danger, ring.
- Motion tokens (duration/easing) and radius scale.
- `ThemeProvider` reading/writing `data-theme` on `<html>` with `light | dark | midnight`.
- Reusable `<GlassCard>`, `<GlassPanel>`, `<GlassNav>` primitives built on tokens.

## 2. Folder architecture

```text
src/
  api/              # replaceable API layer (mock adapter now)
    client.ts       # fetch wrapper, error normalization
    auth.ts users.ts providers.ts employers.ts
    verification.ts search.ts messaging.ts subscriptions.ts
    contracts.md    # documented endpoint contracts
  types/            # shared domain types (User, Provider, Skill, ...)
  features/
    auth/ providers/ employers/ search/ verification/
    messaging/ profile/ shell/
  components/
    ui/             # shadcn primitives (kept)
    glass/          # GlassCard, GlassPanel, GlassNav, GlassButton variant
    common/         # EmptyState, ErrorState, LoadingState, DataStateBoundary
  layouts/
    PublicShell.tsx OpsShell.tsx AuthShell.tsx
  hooks/            # useAuth, useTheme, useMediaQuery (existing use-mobile stays)
  lib/              # utils, formatters, validators (zod schemas)
  routes/           # TanStack Start file routes
    index.tsx
    (public marketing) about.tsx how-it-works.tsx for-employers.tsx for-providers.tsx
    auth/ login.tsx register.tsx recover.tsx
    _app/           # authenticated public app shell (layout route)
      dashboard.tsx
      search.tsx
      providers.$providerId.tsx
      messages.tsx  messages.$conversationId.tsx
      verification.tsx
      account.tsx
    _ops/           # private operations shell (separate nav, NOT a security boundary)
      index.tsx  verification.tsx  moderation.tsx  support.tsx  users.tsx
```

Note: file-based routes use flat dot-syntax; `_app` and `_ops` are pathless layout routes so URLs stay clean (`/dashboard`, `/ops/...` handled via `_ops.<path>` files). Private ops surface is code-separated; a banner clarifies backend authorization is authoritative.

## 3. API + data layer

- `apiClient` wraps `fetch`, injects `VITE_API_BASE_URL` (documented, defaults to in-memory mock), normalizes errors to `ApiError`.
- Each domain module exports typed functions (`listProviders`, `getProvider`, `submitVerification`, ...) that today call a `mockAdapter` seeded with realistic-but-clearly-mock data.
- TanStack Query used for all reads; loader + `useSuspenseQuery` pattern where it fits, `useQuery` for interactive filters.
- `contracts.md` documents every assumed endpoint (method, request, response, auth requirement, errors).

## 4. Auth abstraction (frontend-only, no provider)

- `AuthProvider` context with `status: 'loading' | 'anon' | 'authed'`, `user`, `login`, `register`, `logout`.
- Backed by mock adapter + `localStorage` session token. Clearly marked replaceable.
- No role check is trusted as security; UI gating only.

## 5. Flows scaffolded

Employer: register → role select → profile setup → dashboard → search → filters → provider profile → start conversation → account.
Provider: register → artisan/professional choice → profile setup (skills, experience, certifications, portfolio) → verification submission → status → account.
Provider profile: identity, headline, about, skills, experience, certifications, portfolio grid, verification badge, availability, reviews placeholder, message CTA.
Search: keyword + category + skill + type + verification + location filters, sort dropdown, result cards, empty/loading/error states. Ranking is backend-owned (frontend renders order as returned).
Verification: multi-step form (evidence, CV upload stub, experience, certifications, portfolio), status view, "requests for more info" list. Architected so an automated verification result can slot in.
Messaging: conversation list + thread view + composer + states. Transport hidden behind `messagingApi.subscribe(...)` abstraction (polling in mock, swappable for websockets/SSE).

## 6. Shell & responsiveness

- `PublicShell`: sticky glass top nav (desktop/tablet), bottom tab bar (mobile) — deliberate mobile layout, not shrunk desktop.
- `OpsShell`: sidebar + top bar, distinct visual tone, "Internal" chip.
- Skip-to-content link, focus rings via `--ring`, keyboard nav on menus (Radix/shadcn primitives).

## 7. States, a11y, perf

- `DataStateBoundary` renders loading skeleton / empty / error consistently.
- Semantic HTML, labeled forms with zod + `react-hook-form`, aria-labels on icon buttons, `h-dvh` for full-height layouts, 44px min tap targets.
- No heavy deps added beyond what's already present. Images lazy where used. Lists paginated in mock.

## 8. SEO & metadata

- Per-route `head()` on all public marketing routes and auth pages. No og:image on `__root`. Sitemap + robots.

## 9. Deliverable report

At the end, a concise report covering: what shipped, structure, API assumptions, mock data, env vars (`VITE_API_BASE_URL`), limitations, backend handoff notes.

## Out of scope (explicit)

- No Lovable Cloud / Supabase enablement.
- No real auth provider.
- No real websocket/RT transport.
- No ranking algorithm.
- No payment integration.
- No admin authorization enforcement (UI separation only).

Approve and I'll build it in one pass.
