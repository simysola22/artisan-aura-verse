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
import { requireClerkAuth, requireClerkTokenOnly } from "../middleware/auth.js";
import type { ResolvedIdentity } from "../services/identity.js";
import { serializeIdentity, type ProvisionUserParams } from "../services/identity.js";
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
  /**
   * Correct the account type on an existing user when it disagrees with what
   * the user selected during registration. Only public types are accepted;
   * the Zod schema on the sync route enforces this before this is called.
   */
  correctAccountType: (userId: string, newAccountType: "employer" | "provider") => Promise<void>;
}

// ─── Request body schema ──────────────────────────────────────────────────────

const syncBodySchema = z.object({
  /** Only public account types are accepted. Internal types are rejected. */
  accountType: z.enum(["employer", "provider"]),
  providerKind: z.enum(["artisan", "professional"]).optional(),
  displayName: z.string().min(1).max(200).optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createAuthRouter(adapter: ClerkAuthAdapter, service: AuthIdentityService): Hono {
  const router = new Hono();

  // Full auth: verify Clerk token AND require an existing PMP identity
  const auth = requireClerkAuth(adapter, service.resolve);
  // Token-only auth: verify Clerk token but don't require a PMP identity (used on /sync)
  const clerkOnly = requireClerkTokenOnly(adapter);

  /**
   * GET /v1/auth/me
   *
   * Returns the current authenticated PMP user with roles and permissions.
   * This endpoint is strictly read-only — it never mutates any data.
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
      throw new UnauthorizedError("No PMP account found. Call POST /v1/auth/sync to create one.");
    }

    return c.json(serializeIdentity(identity));
  });

  /**
   * PATCH /v1/auth/me
   *
   * Updates cached Clerk profile fields (displayName, email, avatarUrl) on the
   * authenticated user's PMP record. Used to sync Clerk profile changes to the
   * PMP database without a full re-provision.
   *
   * All fields are optional — only provided fields are updated.
   */
  router.patch(
    "/v1/auth/me",
    auth,
    zValidator(
      "json",
      z.object({
        displayName: z.string().min(1).max(200).optional(),
        email: z.string().email().max(320).optional(),
        avatarUrl: z.string().url().max(2000).optional(),
      }),
    ),
    async (c) => {
      const authCtx = c.get("auth");

      const identity = await service.resolve(authCtx.clerkUserId);
      if (!identity) {
        throw new UnauthorizedError("No PMP account found. Call POST /v1/auth/sync to create one.");
      }

      const body = c.req.valid("json");
      const profile: { displayName?: string; email?: string; avatarUrl?: string } = {};
      if (body.displayName !== undefined) profile.displayName = body.displayName;
      if (body.email !== undefined) profile.email = body.email;
      if (body.avatarUrl !== undefined) profile.avatarUrl = body.avatarUrl;
      if (Object.keys(profile).length > 0) {
        await service.updateProfile(identity.user.id, profile);
      }

      const refreshed = await service.resolve(authCtx.clerkUserId);
      if (!refreshed) throw new UnauthorizedError("Failed to reload identity after update.");
      return c.json(serializeIdentity(refreshed));
    },
  );

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
  router.post("/v1/auth/sync", clerkOnly, zValidator("json", syncBodySchema), async (c) => {
    const { clerkUserId } = c.get("clerkAuth");
    const body = c.req.valid("json");

    // Check for an existing PMP record.
    const existing = await service.resolve(clerkUserId);
    if (existing) {
      // If the stored account type differs from what the user selected,
      // correct it now. This handles accounts that were provisioned with the
      // wrong type (e.g. old-bug accounts created as "employer" when the user
      // intended "provider" because localStorage was cleared by Clerk's
      // email-verification redirect before the unsafeMetadata fix).
      if (existing.user.accountType !== body.accountType) {
        await service.correctAccountType(existing.user.id, body.accountType);
        const corrected = await service.resolve(clerkUserId);
        return c.json(serializeIdentity(corrected!), 200);
      }
      return c.json(serializeIdentity(existing), 200);
    }

    // Build provision params — only include optional fields when present
    const provisionParams: ProvisionUserParams = {
      clerkUserId,
      accountType: body.accountType,
    };
    if (body.providerKind !== undefined) provisionParams.providerKind = body.providerKind;
    if (body.displayName !== undefined) provisionParams.displayName = body.displayName;

    const identity = await service.provision(provisionParams);
    return c.json(serializeIdentity(identity), 201);
  });

  return router;
}
