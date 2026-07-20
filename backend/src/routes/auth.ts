/**
 * Auth routes — /v1/auth/*
 *
 * Clerk owns: registration, login, logout, password reset, email verification.
 * This backend owns: PMP user identity resolution and provisioning.
 *
 * GET  /v1/auth/me    — Return the current authenticated PMP user + roles + permissions.
 * POST /v1/auth/sync  — Create the PMP user record for a newly registered Clerk user.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { UserResolver } from "../middleware/auth.js";
import {
  requireClerkAuth,
} from "../middleware/auth.js";
import type { ResolvedIdentity } from "../services/identity.js";
import {
  serializeIdentity,
  type ProvisionUserParams,
} from "../services/identity.js";
import { UnauthorizedError } from "../errors/index.js";

// ─── Injected identity service interface ──────────────────────────────────────

/**
 * Identity operations required by the auth router.
 * Injected so the real DB is never called in tests.
 */
export interface AuthIdentityService {
  /** Resolve Clerk user ID → PMP identity, or null if not provisioned. */
  resolve: UserResolver;
  /** Create a new PMP user via the public registration flow. */
  provision: (params: ProvisionUserParams) => Promise<ResolvedIdentity>;
  /** Update cached Clerk profile fields on an existing user. */
  updateProfile: (
    userId: string,
    profile: { displayName?: string; email?: string; avatarUrl?: string },
  ) => Promise<void>;
}

// ─── Request body schema ──────────────────────────────────────────────────────

const syncBodySchema = z.object({
  /** Only public account types are accepted. Internal types are rejected. */
  accountType: z.enum(["employer", "provider"]),
  providerKind: z.enum(["artisan", "professional"]).optional(),
  displayName: z.string().min(1).max(200).optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createAuthRouter(
  adapter: ClerkAuthAdapter,
  service: AuthIdentityService,
): Hono {
  const router = new Hono();

  // Build the auth middleware using the injected resolver
  const auth = requireClerkAuth(adapter, service.resolve);

  /**
   * GET /v1/auth/me
   *
   * Returns the current authenticated PMP user with roles and permissions.
   * Frontend should call this on boot instead of trusting a cached User.
   *
   * Returns 401 if:
   *   - No valid Clerk token.
   *   - The Clerk identity has no PMP account (call /v1/auth/sync first).
   */
  router.get("/v1/auth/me", auth, async (c) => {
    const authCtx = c.get("auth");

    // Load fresh identity — permissions always from DB
    const identity = await service.resolve(authCtx.clerkUserId);
    if (!identity) {
      throw new UnauthorizedError(
        "No PMP account found. Call POST /v1/auth/sync to create one.",
      );
    }

    // Opportunistically update cached Clerk profile fields from query params.
    const { displayName, email, avatarUrl } = c.req.query();
    if (displayName ?? email ?? avatarUrl) {
      const profileUpdate: { displayName?: string; email?: string; avatarUrl?: string } = {};
      if (displayName !== undefined) profileUpdate.displayName = displayName;
      if (email !== undefined) profileUpdate.email = email;
      if (avatarUrl !== undefined) profileUpdate.avatarUrl = avatarUrl;
      await service.updateProfile(identity.user.id, profileUpdate);
      // Re-resolve to reflect the update
      const refreshed = await service.resolve(authCtx.clerkUserId);
      if (refreshed) return c.json(serializeIdentity(refreshed));
    }

    return c.json(serializeIdentity(identity));
  });

  /**
   * POST /v1/auth/sync
   *
   * Creates the PMP user record for a Clerk user who has just registered.
   * Idempotent: returns 200 if the PMP account already exists.
   *
   * Security invariants:
   *   - Only "employer" and "provider" account types accepted (Zod schema).
   *   - Internal types (owner, system_admin, etc.) are also blocked by
   *     provisionUser() throwing ForbiddenError — double enforcement.
   */
  router.post("/v1/auth/sync", auth, zValidator("json", syncBodySchema), async (c) => {
    const authCtx = c.get("auth");
    const body = c.req.valid("json");

    // Idempotent: return existing record if already provisioned
    const existing = await service.resolve(authCtx.clerkUserId);
    if (existing) {
      return c.json(serializeIdentity(existing), 200);
    }

    // Build provision params — only include optional fields when present
    const provisionParams: ProvisionUserParams = {
      clerkUserId: authCtx.clerkUserId,
      accountType: body.accountType,
    };
    if (body.providerKind !== undefined) provisionParams.providerKind = body.providerKind;
    if (body.displayName !== undefined) provisionParams.displayName = body.displayName;

    const identity = await service.provision(provisionParams);
    return c.json(serializeIdentity(identity), 201);
  });

  return router;
}
