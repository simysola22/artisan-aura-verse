/**
 * Auth API — bridges Clerk identity to the PMP backend.
 *
 * Real mode (VITE_API_BASE_URL set):
 *   sync() — POST /v1/auth/sync
 *     Called once after a user registers via Clerk. Creates the PMP identity.
 *     Idempotent: returns the existing identity if already provisioned.
 *     The Clerk Bearer token must be in the Authorization header (handled
 *     by apiFetch via the token getter registered in the auth context).
 *
 *   me() — GET /v1/auth/me
 *     Returns the authenticated PMP user, roles, and permissions.
 *     Call this on every page load to get fresh identity from the database.
 *
 * Mock mode (no VITE_API_BASE_URL):
 *   login / register / logout fall through to the in-memory mock adapter
 *   so the frontend remains fully usable without a backend.
 */

import { USE_MOCK_API, apiFetch } from "./client";
import { mockAuth } from "./mock/adapter";
import type { AuthSession, User } from "@/types";

// ─── Backend PMP identity shape (matches serializeIdentity in backend) ─────────

export interface PmpUserRecord {
  id: string;
  clerkUserId: string;
  accountType: string;
  providerKind: string | null;
  status: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PmpIdentityResponse {
  user: PmpUserRecord;
  roles: string[];
  permissions: string[];
}

// ─── Real-backend calls ────────────────────────────────────────────────────────

export interface SyncInput {
  /** The PMP account type being created. employer | provider only. */
  accountType: "employer" | "provider";
  providerKind?: "artisan" | "professional";
  /** Cached display name from Clerk — shown while the user hasn't set one yet. */
  displayName?: string;
}

/**
 * Create or resolve the PMP identity for the currently authenticated Clerk user.
 * Idempotent — safe to call on every sign-in, not just first registration.
 * Requires the Clerk Bearer token in the Authorization header.
 */
export function sync(input: SyncInput): Promise<PmpIdentityResponse> {
  return apiFetch<PmpIdentityResponse>("/v1/auth/sync", {
    method: "POST",
    body: input,
    auth: true,
  });
}

/**
 * Return the authenticated PMP user, roles, and permissions.
 * Returns 401 if no PMP account exists yet (call sync() first).
 */
export function me(): Promise<PmpIdentityResponse> {
  return apiFetch<PmpIdentityResponse>("/v1/auth/me", { auth: true });
}

// ─── Mock-mode compatibility ───────────────────────────────────────────────────
// These are only called when USE_MOCK_API is true so the app works without a backend.

export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterInput {
  email: string;
  password: string;
  role: "employer" | "provider";
  displayName: string;
}
export interface AuthResponse {
  session: AuthSession;
  user: User;
}

export function login(input: LoginInput): Promise<AuthResponse> {
  if (USE_MOCK_API) return mockAuth.login(input.email, input.password);
  // Real mode: sign-in is handled by Clerk components — this should never be called.
  return Promise.reject(new Error("Use Clerk SignIn for authentication in production mode."));
}
export function register(input: RegisterInput): Promise<AuthResponse> {
  if (USE_MOCK_API) return mockAuth.register(input);
  return Promise.reject(new Error("Use Clerk SignUp for registration in production mode."));
}
export function logout(): Promise<void> {
  if (USE_MOCK_API) return mockAuth.logout();
  // Real mode: Clerk handles sign-out; this is a no-op.
  return Promise.resolve();
}
export function recover(email: string): Promise<{ ok: true }> {
  if (USE_MOCK_API) return mockAuth.recover(email);
  // Real mode: password recovery is handled by Clerk.
  return Promise.resolve({ ok: true });
}
