---
name: Clerk auth env var injection
description: How CLERK_PUBLISHABLE_KEY (Replit secret) is exposed to the Vite client bundle, and why auth mode is decoupled from USE_MOCK_API.
---

# Clerk auth env var injection

## The rule
`vite.config.ts` uses `define` to inject `process.env.CLERK_PUBLISHABLE_KEY` (or `VITE_CLERK_PUBLISHABLE_KEY`) as `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY`.

Clerk auth mode (ClerkProvider + ClerkBackedAuthProvider) is gated solely on `CLERK_PUBLISHABLE_KEY` being truthy — never on `USE_MOCK_API`. This lets Clerk work even when `VITE_API_BASE_URL` is not set.

**Why:** Vite only bundles `VITE_`-prefixed env vars into the client. The Replit secret is named `CLERK_PUBLISHABLE_KEY` (no prefix). Without the `define` bridge, the key evaluates to `""` at runtime, Clerk is never mounted, and the error boundary fires ("This page didn't load").

**How to apply:**
- `vite.config.ts` → `define: { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "") }`
- `__root.tsx` → mount ClerkProvider when `CLERK_PUBLISHABLE_KEY` is truthy (not `!USE_MOCK_API && CLERK_PUBLISHABLE_KEY`)
- `auth-context.tsx` / `auth.login.tsx` / `auth.register.tsx` → same condition, keyed on `CLERK_PUBLISHABLE_KEY` only
- Clerk v5: use `forceRedirectUrl` not deprecated `afterSignInUrl` / `afterSignUpUrl`
