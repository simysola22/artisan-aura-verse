/**
 * Authentication and authorization middleware.
 *
 * Stage 2: Clerk-backed.
 *
 * Authentication flow per request:
 *   1. Extract Bearer token from Authorization header.
 *   2. Verify with ClerkAuthAdapter (real: @clerk/backend; tests: mock).
 *   3. Resolve Clerk user ID → PMP identity via the injected UserResolver.
 *   4. Attach AuthContext to c.var.auth.
 *
 * Authorization guards (requirePermission, etc.) are applied after
 * requireClerkAuth and check c.var.auth.permissions.
 *
 * Security invariants:
 *   - Identity always comes from the verified Clerk token, never the request body.
 *   - Permissions always come from PostgreSQL, never the client.
 *   - Frontend-supplied roles are never read or trusted.
 */

import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { ResolvedIdentity } from "../services/identity.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../errors/index.js";
import type { AccountType } from "../db/schema/users.js";

// ─── Request context type ─────────────────────────────────────────────────────

/**
 * The fully resolved authentication context attached to every authenticated
 * request. Available as c.var.auth after requireClerkAuth runs.
 */
export interface AuthContext {
  clerkUserId: string;
  pmpUserId: string;
  accountType: AccountType;
  roleNames: string[];
  permissions: Set<string>;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Function that resolves a Clerk user ID to a PMP identity.
 * Injected into middleware — real impl uses the DB; tests use an in-memory map.
 * Returns null if the user has no PMP account (or is deleted).
 * Throws ForbiddenError if the account is suspended.
 */
export type UserResolver = (
  clerkUserId: string,
) => Promise<ResolvedIdentity | null>;

// ─── Middleware factories ──────────────────────────────────────────────────────

/**
 * Require a valid Clerk session token.
 *
 * @param adapter       Clerk verification adapter (real or mock for tests).
 * @param resolveUser   Identity resolver — injected so tests avoid real DB calls.
 *
 * Returns 401 if token is missing/invalid or no PMP account exists.
 * Returns 403 if the account is suspended.
 */
export function requireClerkAuth(
  adapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError();
    }
    const token = header.slice(7);

    // Step 1: verify with Clerk
    let clerkUserId: string;
    try {
      const result = await adapter.verifyToken(token);
      clerkUserId = result.clerkUserId;
    } catch {
      throw new UnauthorizedError("Invalid or expired authentication token");
    }

    // Step 2: resolve PMP identity (may throw ForbiddenError for suspended)
    const identity = await resolveUser(clerkUserId);
    if (!identity) {
      throw new UnauthorizedError(
        "No PMP account found for this identity. Complete registration first.",
      );
    }

    // Step 3: attach context
    c.set("auth", {
      clerkUserId,
      pmpUserId: identity.user.id,
      accountType: identity.user.accountType,
      roleNames: identity.roleNames,
      permissions: identity.permissions,
    } satisfies AuthContext);

    await next();
  });
}

/**
 * Optionally attach auth if a valid token is present.
 * Does NOT throw on missing/invalid token.
 */
export function optionalClerkAuth(
  adapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      return next();
    }
    const token = header.slice(7);
    try {
      const { clerkUserId } = await adapter.verifyToken(token);
      const identity = await resolveUser(clerkUserId);
      if (identity && identity.user.status === "active") {
        c.set("auth", {
          clerkUserId,
          pmpUserId: identity.user.id,
          accountType: identity.user.accountType,
          roleNames: identity.roleNames,
          permissions: identity.permissions,
        } satisfies AuthContext);
      }
    } catch {
      // Invalid token — continue unauthenticated
    }
    return next();
  });
}

// ─── Authorization guards ─────────────────────────────────────────────────────

/**
 * Require a specific permission. Must run after requireClerkAuth.
 * Returns 403 if the user lacks the permission.
 */
export function requirePermission(permission: string): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw new UnauthorizedError();
    if (!auth.permissions.has(permission)) {
      throw new ForbiddenError(
        `Permission denied: '${permission}' is required for this action.`,
      );
    }
    await next();
  });
}

/**
 * Require at least one of the given permissions.
 * Returns 403 if the user holds none of them.
 */
export function requireAnyPermission(...perms: string[]): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw new UnauthorizedError();
    const hasAny = perms.some((p) => auth.permissions.has(p));
    if (!hasAny) {
      throw new ForbiddenError(
        `Permission denied: one of [${perms.join(", ")}] is required.`,
      );
    }
    await next();
  });
}

/**
 * Require a specific account type. Must run after requireClerkAuth.
 * Returns 403 for a mismatched account type.
 */
export function requireAccountType(...types: AccountType[]): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw new UnauthorizedError();
    if (!types.includes(auth.accountType)) {
      throw new ForbiddenError(
        `Account type '${auth.accountType}' is not permitted for this action.`,
      );
    }
    await next();
  });
}
