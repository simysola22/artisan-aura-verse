# PMP — End-to-End Functionality Audit

**Date:** July 22, 2026  
**Scope:** Full codebase — frontend (TanStack Start / React 19), backend (Hono / Bun), database (Drizzle / PostgreSQL), auth (Clerk), and infrastructure.

---

## Executive Summary

PMP has a well-built technical foundation — clean architecture, working auth, functional provider profiles, working search, and working messaging infrastructure. However, the two core user journeys that make it a *marketplace* — **posting jobs** and **hiring providers** — do not exist anywhere in the codebase. The entire jobs/marketplace layer (database tables, backend routes, frontend pages) is absent. Additionally, a handful of critical flows are wired to demo/mock data instead of the real backend. The app currently functions as a professional directory, not a marketplace.

---

## 🔴 P0 — BLOCKERS

### P0-1: The Entire Jobs / Marketplace System Does Not Exist

**Severity:** P0  
**Affected files/routes:** `src/features/dashboard/demo-data.ts`, `src/features/dashboard/employer-sections.tsx`, `src/features/dashboard/provider-sections.tsx` — no backend files affected because nothing exists  
**User journey:** Employer: Create job → Publish → Receive applications. Provider: Discover jobs → View job → Apply.

**Root cause:** No database schema, no backend routes, and no frontend pages exist for the job marketplace. What currently appears in the dashboard as "Available Jobs" and "Post a job" is entirely mock demo data from `src/features/dashboard/demo-data.ts`.

**Currently happening:**
- `employer-sections.tsx` imports `DEMO_JOBS` and `DEMO_TALENTS` and renders them with a `DemoBanner` warning (visible only to developers, not users).
- `provider-sections.tsx` does the same.
- The "Find Jobs" button on the provider dashboard navigates to `/search`, which searches for *providers*, not jobs.
- There is no `/jobs`, `/jobs/$id`, `/jobs/create`, or `/jobs/$id/apply` route anywhere.
- There are no `jobs`, `job_applications`, or `proposals` tables in the database.
- There are no job-related backend routes.

**What should happen:** Both core journeys — employer posting a job, provider finding and applying — should be functional end-to-end.

**Recommended fix:** Build the full jobs layer in this order: DB schema (jobs + applications tables) → backend CRUD routes → frontend job creation form → job discovery/search → job detail page → application submission.

**Layers:** Database + Backend + Frontend  
**Blockers:** None — this is a greenfield addition.

---

### P0-2: There Is No Way to Start a New Conversation

**Severity:** P0  
**Affected files:** `src/routes/providers.$providerId.tsx` (line 81–86), `src/routes/messages.tsx` (line 44), `backend/src/routes/messaging.ts` (`POST /v1/messaging/conversations`)  
**User journey:** Employer views a provider profile → clicks "Message" → starts conversation.

**Root cause:** The "Message" button on the provider profile page is a `<Link to="/messages">` — it navigates to the messages list but does not call `POST /v1/messaging/conversations` to create or find a thread with that provider. The backend endpoint to create a conversation exists and is correct but is never called by any UI element.

**Currently happening:** Clicking "Message" on a provider's profile dumps the employer on the messages list page. If they have no existing conversations (which they won't on a fresh account), they see an empty state with no way to start one.

**What should happen:** Clicking "Message" should call `POST /v1/messaging/conversations` (passing the provider's user ID), then navigate to the resulting conversation thread.

**Recommended fix:** Change the Message button to a click handler that calls `messagingApi.createConversation(providerUserId)` and navigates to `/messages/:conversationId` on success.

**Layers:** Frontend  
**Dependencies:** Requires the user to be authenticated and have a PMP identity.

---

### P0-3: Verification Evidence Upload Is a Non-Functional Placeholder

**Severity:** P0  
**Affected files:** `src/routes/verification.tsx` (lines 112–121), `src/api/verification.ts` (`addEvidence`, `removeEvidence`)  
**User journey:** Provider: Verification → upload evidence → submit.

**Root cause:** The 5-step verification wizard renders a generic drag-and-drop file upload placeholder in every step. The component never calls `verificationApi.addEvidence()`. The backend endpoints `POST /v1/verification/cases/:id/evidence` and `DELETE /v1/verification/cases/:id/evidence/:evidenceId` are fully implemented and waiting for callers.

**Currently happening:** A provider can click through all 5 verification steps and hit "Submit", but no evidence is ever attached. The submitted case will have zero evidence, making admin review impossible and verification meaningless.

**What should happen:** Each step should call `addEvidence` to attach evidence items (URLs or file references) to the case, and allow removing them before submission.

**Recommended fix:** Wire `verificationApi.addEvidence` and `verificationApi.removeEvidence` into each step. Separately, implement actual file upload (to a storage service — see P1-4 on missing file storage).

**Layers:** Frontend  
**Dependencies:** P1-4 (file storage) for binary uploads; URL-based evidence can be wired immediately.

---

### P0-4: `/verification` Route Uses a Hardcoded Demo Provider ID — Unauthenticated Access Not Blocked

**Severity:** P0  
**Affected files:** `src/routes/verification.tsx` (line 30)  
**User journey:** Any user visiting `/verification` without being a signed-in provider.

**Root cause:** `verification.tsx` falls back to `"p3"` as the provider ID when `user.role !== "provider"`. This means:
1. An unauthenticated user can access `/verification` and mutate the `p3` demo account's verification data.
2. An employer who navigates to `/verification` operates against the demo account silently.
3. There is no redirect to `/auth/login` for anonymous users, unlike `/dashboard` and `/messages`.

**Currently happening:** Any anonymous visitor can load the verification page and interact with the "p3" demo provider's verification case.

**What should happen:** The route should redirect to `/auth/login` if `status === "anon"`, and render an error/redirect if the user is not a provider.

**Recommended fix:** Add an auth + role guard at the top of `verification.tsx`, identical to the pattern in `dashboard.tsx`.

**Layers:** Frontend  
**Dependencies:** None.

---

## 🟠 P1 — CRITICAL

### P1-1: Dashboard Employer and Provider Sections Show Only Demo Data — Never Real API Data

**Severity:** P1  
**Affected files:** `src/features/dashboard/employer-sections.tsx`, `src/features/dashboard/provider-sections.tsx`, `src/features/dashboard/demo-data.ts`  
**User journey:** Any signed-in user landing on `/dashboard`.

**Root cause:** Both employer and provider dashboard sections explicitly import `DEMO_JOBS` and `DEMO_TALENTS` from `demo-data.ts`. The files contain a developer warning at lines 4–5 ("Replace the DEMO_* imports with real API queries...") but this was never acted on. The components render a `DemoBanner` — but the banner is styled for developer awareness; it is not an obvious blocker for an end user, who may assume the data is real.

**Currently happening:** A brand-new employer or provider sees fake job and talent listings on their dashboard regardless of what's in the database.

**What should happen:** The dashboard should call the real jobs/providers API. Until the jobs system exists (P0-1), the employer section should show an empty state prompting job creation, and the provider section should show an empty state prompting profile completion.

**Recommended fix:** Remove `DEMO_*` imports. Replace with real API calls (or explicit "no jobs yet" empty states for the job sections until P0-1 is built).

**Layers:** Frontend  
**Dependencies:** P0-1 (jobs system) for the job listings half.

---

### P1-2: There Is No Profile Editing UI

**Severity:** P1  
**Affected files:** `src/routes/account.tsx`, `src/routes/dashboard.tsx`  
**User journey:** Provider: edit headline, about, skills, hourly rate, availability. Employer: edit organization name, description, location.

**Root cause:** `account.tsx` is display-only — it shows Name, Email, and Role with no editing forms. The backend has fully working `PATCH /v1/providers/profile` and `PATCH /v1/employers/profile` endpoints, but no frontend page calls them. The backend also supports adding/deleting experience, certifications, and portfolio items — all with no frontend editing UI.

**Currently happening:** A user can create a profile during onboarding (if a creation form exists during the sync step — needs verification) but can never update it afterward.

**What should happen:** A profile settings page where providers can update all profile fields (headline, about, skills, availability, rate) and manage experience/certifications/portfolio items. Similarly for employers.

**Recommended fix:** Build a `/account/profile` or dedicated settings section that calls the existing PATCH/POST/DELETE endpoints.

**Layers:** Frontend  
**Dependencies:** None — backend is ready.

---

### P1-3: Messaging Has No Real-Time Updates — Incoming Messages Invisible Until Refresh

**Severity:** P1  
**Affected files:** `src/api/messaging.ts` (`subscribe` function), conversation view component  
**User journey:** Provider and employer in an active conversation.

**Root cause:** The backend implements SSE at `GET /v1/messaging/conversations/:id/stream`. The frontend has a `subscribe()` function in `src/api/messaging.ts` that correctly implements the SSE reader. However, no React component ever calls `subscribe()`. Message updates only appear when React Query's cache invalidation triggers (i.e., after the current user sends a message), meaning messages from the *other* party are invisible until the page is refreshed.

**Currently happening:** User A sends a message. User B receives nothing until they manually refresh.

**What should happen:** The conversation view should open an SSE subscription for the active conversation and append incoming messages in real time.

**Recommended fix:** Call `messagingApi.subscribe(conversationId, onMessage)` inside `ConversationView` (in a `useEffect` with cleanup) to push incoming messages into the React Query cache or local state.

**Layers:** Frontend  
**Dependencies:** Requires P0-2 (conversation creation) so there are actual conversations to subscribe to.

---

### P1-4: No File Storage Service — Verification Evidence Accepts Only URLs

**Severity:** P1  
**Affected files:** `backend/src/routes/verification.ts` (`POST /v1/verification/cases/:id/evidence` — `fileUrl` required field), `src/api/verification.ts` (`AddEvidenceInput`)  
**User journey:** Provider uploading portfolio images, ID documents, or certificates.

**Root cause:** The `verification_evidence` table has `file_url` and `storage_key` fields, and the backend accepts a `fileUrl` string. However, there is no file upload endpoint and no storage integration (no S3, no Cloudinary, no local storage). A user would need to already have the file hosted somewhere and paste a URL — an unrealistic expectation for most users.

**Currently happening:** Evidence can only be added by URL. There is no binary file upload path.

**What should happen:** Implement a file upload endpoint (multipart/form-data) backed by an object storage service, returning a URL to be stored as `fileUrl`.

**Recommended fix:** Integrate an object storage service (S3, Cloudflare R2, or similar). Add a `POST /v1/uploads` endpoint. Update the verification UI to upload files and then call `addEvidence` with the returned URL.

**Layers:** Backend + Infrastructure + Frontend  
**Dependencies:** None.

---

### P1-5: Messaging Participant DTO Mismatch — Conversations Will Fail to Render Participant Names

**Severity:** P1  
**Affected files:** `src/api/messaging.ts` (frontend `Conversation` type), `backend/src/routes/messaging.ts` (response serializer)  
**User journey:** Any user viewing the messages list.

**Root cause:** The backend's `ConversationDto.participants` array uses `userId` as the field name. The frontend `Conversation` type expects `id`. Additionally, the backend `ParticipantDto` omits the `role` field entirely, which the frontend expects.

**Currently happening:** Any component that renders `participant.id` or `participant.role` from a real backend response will get `undefined`. Names and roles will be missing from conversation headers.

**What should happen:** The field names must match. Either the backend should serialize `id` instead of `userId`, or the frontend type and access patterns need updating.

**Recommended fix:** Update the backend `ParticipantDto` serializer to output `id` (not `userId`) and include `role` (by joining `users.account_type`). This is the cleanest fix — the frontend types and the rest of the UI are already written to expect `id` and `role`.

**Layers:** Backend  
**Dependencies:** None.

---

### P1-6: Ops Verification Queue Shows Provider Profiles, Not Verification Cases

**Severity:** P1  
**Affected files:** `src/routes/ops.verification.tsx`  
**User journey:** Ops agent reviewing pending verification submissions.

**Root cause:** `ops.verification.tsx` calls `providersApi.list()` and filters/displays results by their `verification_status` field on the provider profile. It does not query the `verification_cases` table. This means the ops agent sees a list of providers whose profile status is "in_review" but has no access to the actual submitted evidence, notes, history, or actions (claim, approve, reject, request info) from the verification system.

**Currently happening:** Ops sees a list of provider names with a status badge. Cannot review, action, or manage any verification case.

**What should happen:** The ops verification page should query `GET /v1/ops/verification` (which the backend implements), showing the actual case queue with full case detail views.

**Recommended fix:** Replace `providersApi.list()` with the ops verification API calls. Build a case detail view that shows submitted evidence, allows claiming, approving, rejecting, or requesting more info.

**Layers:** Frontend  
**Dependencies:** None — the full ops verification backend (`/v1/ops/verification/*`) is already implemented.

---

### P1-7: Ops Moderation and Support Pages Are Empty Shells

**Severity:** P1  
**Affected files:** `src/routes/ops.moderation.tsx`, `src/routes/ops.support.tsx`  
**User journey:** Ops agent handling content reports or support tickets.

**Root cause:** Both routes render an `EmptyState` component with no real content or API calls. The backend has complete support ticket and content moderation endpoints (`/v1/ops/support/*`, `/v1/ops/moderation/*`), as well as full database tables.

**Currently happening:** An ops user navigating to Moderation or Support sees a blank placeholder page.

**What should happen:** Functional ticket and report queues backed by the real backend.

**Recommended fix:** Build UI for both pages using the existing ops backend routes. A support ticket list + detail view, and a content report queue + action panel.

**Layers:** Frontend  
**Dependencies:** None — backends are complete.

---

## 🟡 P2 — IMPORTANT

### P2-1: Auth Guards Use `useEffect` — Protected Routes Flash Content Before Redirect

**Severity:** P2  
**Affected files:** `src/routes/dashboard.tsx`, `src/routes/account.tsx`, `src/routes/messages.tsx`  
**User journey:** Any unauthenticated user visiting a protected route directly by URL.

**Root cause:** Route protection is implemented as `useEffect(() => { if (status === "anon") navigate("/auth/login") }, [status])`. TanStack Router supports `beforeLoad` route guards that fire synchronously before rendering. `useEffect` runs *after* render, meaning the page content briefly mounts before the redirect fires — a flash of protected content.

**Currently happening:** Navigating to `/dashboard` while unauthenticated briefly renders the dashboard skeleton before redirecting.

**What should happen:** The redirect should fire before the route renders, with no flash.

**Recommended fix:** Replace `useEffect`-based guards with TanStack Router's `beforeLoad` guard in the route definition, which executes on the server/before paint and prevents any render of the protected component.

**Layers:** Frontend  
**Dependencies:** None.

---

### P2-2: Verification Evidence Is Mapped to an Empty Array — Returning to a Draft Shows No Evidence

**Severity:** P2  
**Affected files:** `src/api/verification.ts` (the `caseToApplication` mapping function, line ~96)  
**User journey:** Provider creates a draft verification case, adds evidence, leaves, returns.

**Root cause:** The `caseToApplication` helper that converts a backend `VerificationCase` into the frontend `VerificationApplication` shape returns an empty array `[]` for `evidence`. This is because the frontend's `PortfolioItem` shape (`mediaUrl`, `mediaType`) doesn't map cleanly to the backend's `EvidenceItem` shape (`fileUrl`, `evidenceType`). Rather than implementing the mapping, it was left empty.

**Currently happening:** A provider who submits evidence, navigates away, and returns to the verification page sees zero evidence items — even if evidence was successfully saved to the database.

**What should happen:** The `caseToApplication` function should map backend `EvidenceItem` fields to frontend display fields correctly.

**Recommended fix:** Fix the `caseToApplication` mapper: `fileUrl → mediaUrl`, `evidenceType → mediaType` (with a type normalization). This is a 5-line fix.

**Layers:** Frontend  
**Dependencies:** P0-3 (so evidence can actually be added in the first place).

---

### P2-3: "Message" Button on Provider Profile Does Not Target That Provider

**Severity:** P2  
**Affected files:** `src/routes/providers.$providerId.tsx` (line 81–86)  
*(This is the routing-level consequence of P0-2 — listed separately because even after P0-2 is fixed, the current button implementation needs updating.)*

**Root cause:** The button is `<Link to="/messages">` with no state or query param indicating which provider to message.

**Currently happening:** Employer clicks "Message" on a provider profile, lands on their inbox with no pre-selected conversation and no way to start one.

**What should happen:** The button should start or resume a conversation with the specific provider and navigate directly to that thread.

**Recommended fix:** Fix as part of P0-2 — change to a click handler that calls `POST /v1/messaging/conversations` and redirects to the resulting conversation.

**Layers:** Frontend  
**Dependencies:** P0-2.

---

### P2-4: Dashboard "Average Response" Stat Is Hardcoded

**Severity:** P2  
**Affected files:** `src/routes/dashboard.tsx`  
**User journey:** Any signed-in user viewing the dashboard.

**Root cause:** The stat card showing "Average response: 2h 14m" is static text in the template. It is not fetched from any API.

**Currently happening:** Every user sees "2h 14m" regardless of their actual messaging behavior.

**What should happen:** This should either be computed from real messaging timestamps (average time between first message and first reply), or the stat should be removed until it can be calculated.

**Recommended fix:** Remove the hardcoded value and replace with a real query, or remove the stat card entirely. A misleading KPI is worse than no KPI.

**Layers:** Frontend + Backend  
**Dependencies:** P1-3 (messaging must be functional first).

---

### P2-5: No Profile Creation UI After Registration — Sync Creates a User Record But No Profile

**Severity:** P2  
**Affected files:** `src/features/auth/auth-context.tsx` (sync flow), `backend/src/routes/auth.ts` (`POST /v1/auth/sync`)  
**User journey:** New user registers → lands on dashboard with no profile.

**Root cause:** `POST /v1/auth/sync` creates a `users` record and assigns the `employer` or `provider` role. It does **not** create a `provider_profiles` or `employer_profiles` record. The backend `POST /v1/providers/profile` and `POST /v1/employers/profile` require a separate call. There is no onboarding step after sync that calls these profile creation endpoints.

**Currently happening:** A brand-new provider who completes Clerk registration lands on `/dashboard` with a `users` record but no `provider_profiles` row. Any frontend call to `GET /v1/providers/profile` returns a 404.

**What should happen:** Either sync should auto-create a minimal profile, or there should be an onboarding flow that collects profile basics and calls `POST /v1/providers/profile` or `POST /v1/employers/profile`.

**Recommended fix:** Add a post-sync onboarding step (a modal or `/onboarding` route) that collects the minimum profile fields and creates the profile record. Alternatively, update the sync endpoint to auto-create a minimal blank profile.

**Layers:** Frontend + Backend  
**Dependencies:** Blocks P1-2 (can't edit a profile that doesn't exist yet).

---

### P2-6: `GET /v1/providers/:profileId` Requires Auth — Public Profiles Are Inaccessible to Anonymous Users

**Severity:** P2  
**Affected files:** `backend/src/routes/providers.ts` (`GET /v1/providers/:profileId`)  
**User journey:** A non-logged-in visitor finding a provider via a shared link and viewing their profile.

**Root cause:** The route has the `requireAuth` middleware applied. Since provider profiles are public (`is_public: true`), they should be accessible without a Clerk token.

**Currently happening:** An unauthenticated user visiting `/providers/some-id` gets a 401 from the backend. The frontend's `DataStateBoundary` shows an error state.

**What should happen:** Public provider profiles should be accessible without authentication. Authentication can still be required to message or interact.

**Recommended fix:** Remove `requireAuth` from the `GET /v1/providers/:profileId` handler. If needed, use `optionalAuth` middleware to identify the requester without blocking the request.

**Layers:** Backend  
**Dependencies:** None.

---

### P2-7: Billing/Subscription Has No Frontend UI — Users Cannot Subscribe

**Severity:** P2  
**Affected files:** `src/api/subscriptions.ts`, `backend/src/routes/billing.ts`  
**User journey:** User wants to upgrade to a paid plan.

**Root cause:** The billing backend (Paystack integration, plans, checkout, webhooks) is fully implemented. The frontend `src/api/subscriptions.ts` API client is complete. But no frontend page, modal, or route calls any billing function. The `subscription_plans` table seeds plans with `is_active = FALSE`.

**Currently happening:** Billing infrastructure sits unused. Users cannot see plans, initiate checkout, or manage subscriptions.

**What should happen:** A pricing page or settings section showing available plans, with a "Subscribe" flow that calls `initializeCheckout` and redirects to the Paystack payment URL.

**Recommended fix:** (1) Seed `subscription_plans` with `is_active = TRUE` records. (2) Add a `/pricing` or `/account/billing` route. (3) Set `PAYSTACK_SECRET_KEY` in the environment. (4) Wire the checkout flow.

**Layers:** Frontend + Configuration  
**Dependencies:** `PAYSTACK_SECRET_KEY` environment variable must be set.

---

### P2-8: `localStorage` Dependency in Auth Sync Is Fragile

**Severity:** P2  
**Affected files:** `src/routes/auth.register.tsx`, `src/features/auth/auth-context.tsx`  
**User journey:** New user registers with Clerk, especially via OAuth (Google).

**Root cause:** During registration, the selected account type (`employer`/`provider`) is written to `localStorage` before the Clerk `SignUp` component handles its flows (email verification, OAuth redirects). If the user completes registration on a different device, uses a private browsing window, or clears storage before the Clerk redirect returns, the `accountType` is `null` and `authApi.sync()` is called with no account type. The backend's Zod schema requires `accountType` — this will cause a `sync_error` state.

**Currently happening:** Users who complete registration across devices or with certain browser settings will be stuck in `sync_error` state with no way to recover.

**What should happen:** The account type should be passed via a mechanism that survives cross-device flows — Clerk's `unsafeMetadata` (written during the role selection step and readable on any device after sign-in) is the correct solution.

**Recommended fix:** Use Clerk's `signUp.update({ unsafeMetadata: { accountType } })` during role selection. In the sync flow, read `user.unsafeMetadata.accountType` from the Clerk session as the primary source, with `localStorage` as a fallback.

**Layers:** Frontend  
**Dependencies:** None.

---

## 🔵 P3 — POLISH

### P3-1: Messaging Message Status Enum Mismatch

**Severity:** P3  
**Affected files:** `src/api/messaging.ts` (frontend `Message.status`), `backend/src/routes/messaging.ts`  
**Details:** Frontend `Message.status` expects `"sending" | "sent" | "delivered" | "read" | "failed"`. Backend always returns `"sent"`. The `delivered` and `read` states are not tracked in the database. This is acceptable now but will need the schema extended (e.g., `message_receipts` table or `read_at` fields) if read receipts are added later.

---

### P3-2: No Token Expiry / Silent Re-auth Handling

**Severity:** P3  
**Affected files:** `src/features/auth/auth-context.tsx`, `src/api/client.ts`  
**Details:** If a Clerk token expires mid-session and the silent refresh fails, the user stays in `authed` state but all API calls start returning 401. There is no handler that detects this and transitions back to `syncing` or shows a re-auth prompt. Users will see API error states without understanding why.

---

### P3-3: Search Location Filter Is a Hardcoded "Near London" Toggle

**Severity:** P3  
**Affected files:** `src/routes/search.tsx`  
**Details:** The location filter in the search UI is a boolean toggle labeled "Near London" rather than a real location input. The backend's location filter is a generic substring match, so a proper city/region input field should be used instead.

---

### P3-4: Several Backend Filters Not Exposed in Search UI

**Severity:** P3  
**Affected files:** `src/routes/search.tsx`, `backend/src/routes/search.ts`  
**Details:** Backend supports `skillId`, `availabilityStatus`, `minExperience`, and `minCompleteness` filters. None are in the UI. These would significantly improve the quality of employer searches.

---

### P3-5: No Pagination UI in Provider Search Results

**Severity:** P3  
**Affected files:** `src/routes/search.tsx`  
**Details:** The backend returns paginated results with `total`, `page`, and `limit` fields. The frontend renders results but there is no "Load more" or page navigation UI.

---

### P3-6: Portfolio Section on Provider Profile Page Renders Titles Only

**Severity:** P3  
**Affected files:** `src/routes/providers.$providerId.tsx` (lines 137–155)  
**Details:** The portfolio section renders a placeholder grid showing `title` fields. It does not render `mediaUrl` images or embedded media. The full portfolio viewer is not implemented.

---

### P3-7: Rate Limiter Is In-Memory — Resets on Every Restart

**Severity:** P3  
**Affected files:** `backend/src/middleware/rate-limit.ts`  
**Details:** The sliding window rate limiter stores state in memory. Every process restart clears all counters. In production (or with multiple backend instances), this means rate limiting provides no protection. A Redis-backed store is needed.

---

### P3-8: No Error Tracking / Observability

**Severity:** P3  
**Affected files:** `backend/src/main.ts`  
**Details:** There is Pino logging in the backend but no error tracking service (Sentry, Bugsnag, etc.). Unhandled errors will be logged to stdout but not alerted or aggregated.

---

### P3-9: Delete Certification and Delete Portfolio Item Endpoints Exist on Backend But Have No Frontend UI

**Severity:** P3  
**Affected files:** `backend/src/routes/providers.ts` (DELETE endpoints), `src/api/providers.ts`  
**Details:** Providers can add certifications and portfolio items but cannot remove them — there is no delete button or API call from any frontend component.

---

## API Contract Verification Table

| Frontend function | Method | Frontend path | Backend route | Match? | Notes |
|---|---|---|---|---|---|
| `auth.sync` | POST | `/v1/auth/sync` | ✅ exists | ✅ MATCH | — |
| `auth.me` | GET | `/v1/auth/me` | ✅ exists | ✅ MATCH | — |
| `employers.getProfile` | GET | `/v1/employers/profile` | ✅ exists | ✅ MATCH | — |
| `employers.createProfile` | POST | `/v1/employers/profile` | ✅ exists | ✅ MATCH | — |
| `employers.updateProfile` | PATCH | `/v1/employers/profile` | ✅ exists | ✅ MATCH | — |
| `providers.getProfile` | GET | `/v1/providers/profile` | ✅ exists | ✅ MATCH | — |
| `providers.createProfile` | POST | `/v1/providers/profile` | ✅ exists | ✅ MATCH | — |
| `providers.updateProfile` | PATCH | `/v1/providers/profile` | ✅ exists | ✅ MATCH | — |
| `providers.addExperience` | POST | `/v1/providers/profile/experience` | ✅ exists | ✅ MATCH | — |
| `providers.deleteExperience` | DELETE | `/v1/providers/profile/experience/:id` | ✅ exists | ✅ MATCH | — |
| `providers.addCertification` | POST | `/v1/providers/profile/certifications` | ✅ exists | ✅ MATCH | — |
| `providers.addPortfolio` | POST | `/v1/providers/profile/portfolio` | ✅ exists | ✅ MATCH | — |
| `providers.get` (public) | GET | `/v1/providers/:profileId` | ✅ exists | ⚠️ ISSUE | Requires auth — should be public (P2-6) |
| `reference.categories` | GET | `/v1/reference/categories` | ✅ exists | ✅ MATCH | — |
| `reference.skills` | GET | `/v1/reference/skills` | ✅ exists | ✅ MATCH | — |
| `search.providers` | GET | `/v1/search/providers` | ✅ exists | ✅ MATCH | — |
| `subscriptions.listPlans` | GET | `/v1/billing/plans` | ✅ exists | ✅ MATCH | No UI calls this |
| `subscriptions.initializeCheckout` | POST | `/v1/billing/checkout` | ✅ exists | ✅ MATCH | No UI calls this |
| `subscriptions.getMyBilling` | GET | `/v1/billing/me` | ✅ exists | ✅ MATCH | No UI calls this |
| `subscriptions.getEntitlements` | GET | `/v1/billing/me/entitlements` | ✅ exists | ✅ MATCH | No UI calls this |
| `messaging.listConversations` | GET | `/v1/messaging/conversations` | ✅ exists | ⚠️ PARTIAL | Backend `participant.userId` vs frontend `participant.id` (P1-5) |
| `messaging.listMessages` | GET | `/v1/messaging/conversations/:id/messages` | ✅ exists | ⚠️ PARTIAL | Backend has extra `editedAt`, `isDeleted` fields |
| `messaging.sendMessage` | POST | `/v1/messaging/conversations/:id/messages` | ✅ exists | ✅ MATCH | — |
| `messaging.createConversation` | POST | `/v1/messaging/conversations` | ✅ exists | ❌ NOT CALLED | No UI triggers this (P0-2) |
| `messaging.subscribe` (SSE) | GET | `/v1/messaging/conversations/:id/stream` | ✅ exists | ❌ NOT INTEGRATED | Implemented in API client, never called in components (P1-3) |
| `verification.getCases` | GET | `/v1/verification/cases` | ✅ exists | ✅ MATCH | — |
| `verification.createCase` | POST | `/v1/verification/cases` | ✅ exists | ✅ MATCH | — |
| `verification.submitCase` | POST | `/v1/verification/cases/:id/submit` | ✅ exists | ✅ MATCH | — |
| `verification.addEvidence` | POST | `/v1/verification/cases/:id/evidence` | ✅ exists | ❌ NOT CALLED | UI has placeholder, never calls this (P0-3) |
| `verification.removeEvidence` | DELETE | `/v1/verification/cases/:id/evidence/:evidenceId` | ✅ exists | ❌ NOT CALLED | — |
| `verification.resubmitCase` | POST | `/v1/verification/cases/:id/resubmit` | ✅ exists | ✅ MATCH | No UI trigger to resubmit |
| **Jobs (any)** | — | — | ❌ MISSING | ❌ ENTIRELY ABSENT | No job tables, no backend, no frontend (P0-1) |

**Backend routes with no frontend callers:**
- `PATCH /v1/messaging/messages/:id` — no edit UI
- `DELETE /v1/messaging/messages/:id` — no delete UI  
- `POST /v1/messaging/messages/:id/report` — no report UI
- `POST /v1/messaging/users/:id/block` — no block UI
- `DELETE /v1/providers/profile/certifications/:id` — no delete UI in frontend (P3-9)
- `DELETE /v1/providers/profile/portfolio/:id` — no delete UI in frontend (P3-9)
- All `/v1/billing/*` endpoints — no frontend pages (P2-7)
- All `/v1/ops/support/*` endpoints — page is EmptyState (P1-7)
- All `/v1/ops/moderation/*` endpoints — page is EmptyState (P1-7)
- `/v1/ops/verification/*` — page calls wrong API (P1-6)

---

## Security Summary

| Area | Status | Notes |
|---|---|---|
| Clerk token verification | ✅ Correct | `verifyToken()` via `@clerk/backend` |
| Cross-role access (employer/provider) | ✅ Enforced | `requireAccountType` middleware |
| Messaging IDOR | ✅ Enforced | `assertParticipant` checks in service layer |
| Verification IDOR | ✅ Enforced | `userId` filter on all own-case queries |
| Ops route protection | ✅ Enforced | Permission check on all `/v1/ops/*` routes |
| Public search data leakage | ✅ Enforced | `isPublic: true` filter on all public queries |
| Rate limiting | ✅ Present | 100 req/min globally; in-memory only (P3-7) |
| CORS | ✅ Configured | Driven by `CORS_ORIGIN` env var |
| Zod input validation | ✅ On most routes | `DELETE` routes generally lack Zod (low risk) |
| Secrets exposed to frontend | ✅ Safe | `CLERK_SECRET_KEY` is backend-only |
| File upload | ⚠️ N/A | No file upload endpoint exists (P1-4) |

---

## Production Readiness Summary

| Item | Status | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ Set | Replit secret |
| `CLERK_SECRET_KEY` | ✅ Set | Replit secret |
| `CLERK_PUBLISHABLE_KEY` | ✅ Set | Replit secret (vite.config.ts maps it) |
| `CORS_ORIGIN` | ✅ Set | Replit secret |
| `PAYSTACK_SECRET_KEY` | ❌ Missing | Billing non-functional |
| Database migrations | ✅ Auto-run on startup | |
| Logging | ✅ Pino structured logs | Backend only |
| Error tracking | ❌ None | No Sentry or equivalent |
| File storage | ❌ None | No binary upload capability |
| Email service | ❌ None | No transactional email |
| Rate limiting | ⚠️ In-memory | Resets on restart, not multi-instance safe |
| Build process | ✅ `vite build` defined | |
| SSR / Vite proxy | ✅ `/v1` proxied to `:3000` in dev | |

---

## RECOMMENDED BUILD ORDER

Fix issues in this sequence to avoid discovering a new blocker every time you complete a fix.

**Phase 1 — Fix the Foundation (Auth, Profiles, Guards)**

1. **P0-4** — Add auth + role guard to `/verification` (30 min, eliminates demo data corruption)
2. **P2-5** — Build post-sync onboarding that creates a provider or employer profile record (without this, the entire profile and verification system is unusable on new accounts)
3. **P2-1** — Upgrade route guards from `useEffect` to TanStack Router `beforeLoad` (1–2 hours, affects all protected routes)
4. **P2-8** — Fix `localStorage` sync fragility by using Clerk `unsafeMetadata` (2 hours, prevents registration failures for OAuth users)

**Phase 2 — Fix Core Working Features (Profile, Messaging, Verification)**

5. **P1-5** — Fix messaging `participant.userId` → `participant.id` DTO mismatch (30 min, makes conversations render correctly)
6. **P1-3** — Wire SSE subscription into the conversation view (2 hours, makes messaging feel real)
7. **P0-2** — Implement create-conversation from the provider profile page (2 hours, enables the primary contact flow)
8. **P2-3** — Update the provider profile "Message" button to navigate to the new conversation (30 min, depends on P0-2)
9. **P2-6** — Remove auth requirement from `GET /v1/providers/:profileId` (15 min, makes public profiles shareable)
10. **P0-3** — Wire `addEvidence` and `removeEvidence` calls into the verification wizard steps (3 hours)
11. **P2-2** — Fix the `caseToApplication` evidence mapping (30 min, so returning to a draft shows saved evidence)
12. **P1-4** — Implement file upload endpoint + object storage (1–2 days, needed for real evidence and portfolio uploads)
13. **P1-2** — Build the profile editing UI for providers and employers (1 day, uses existing backend PATCH endpoints)
14. **P3-9** — Add delete buttons for certifications and portfolio items (1 hour)

**Phase 3 — Fix the Ops Layer**

15. **P1-6** — Replace `providersApi.list()` in ops/verification with real verification case API (3 hours)
16. **P1-7** — Build ops/support ticket queue and ops/moderation content report queue (2–3 days, backends complete)

**Phase 4 — Build the Marketplace Core (Jobs)**

17. **P0-1** — Build the full jobs layer:
    - DB migration: `jobs` table + `job_applications` table (1 day)
    - Backend CRUD routes: create/edit/publish/list/search/apply (2–3 days)
    - Frontend: Job creation form, job detail page, application flow, job search (3–5 days)
    - Connect to dashboard sections replacing demo data (1 day)

**Phase 5 — Dashboard Data and Billing**

18. **P1-1** — Remove all demo data from dashboard sections, replace with real API calls (1 day, depends on Phase 4)
19. **P2-4** — Remove or compute the hardcoded "Average response" stat (depends on P1-3)
20. **P2-7** — Build billing/subscription UI and activate plans (2–3 days, backend complete)

**Phase 6 — Polish**

21. **P3-1 through P3-8** — Address remaining polish items as capacity allows.

---

*The application is not yet a marketplace — it is a functional professional directory with working auth, provider profiles, and search. The minimum viable marketplace requires completing Phases 1–4 above.*
